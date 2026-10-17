"use strict";

const crypto = require("crypto");
const path = require("path");

require("fs").writeFileSync(path.join(__dirname, "entries/css/themes.css"), require("./common/themes").themeCSS());
const webpack = require("webpack");
const { RawSource } = require("webpack-sources");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

class HashPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("HashPlugin", compilation => {
      compilation.hooks.processAssets.tap({
        name: "HashPlugin",
        stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
      }, () => {
        const d = crypto.createHmac("sha224", "hobbyfiles");
        const assets = compilation.getAssets().sort((a, b) => a.name.localeCompare(b.name));
        for (const asset of assets) {
          d.update(asset.name);
          d.update(asset.source.source());
        }
        compilation.emitAsset("../lib/clientversion.js", new RawSource(
          `module.exports = '${d.digest("hex").slice(0, 10)}';\n`,
        ));
      });
    });
  }
}

module.exports = {
  mode: "development",
  context: path.join(__dirname, "entries"),
  entry: {
    "theme": "./theme.js",
    "client": "./main.js",
    "register": "./register.js",
    "account": "./account.js",
    "user": "./user.js",
    "status": "./status.js",
    "sortable": "./sortable.js",
    "style": "./css/style.css",
    // PDF.js web worker — served at /pdf.worker.js, referenced by reader.js
    "pdf.worker": "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "static"),
    publicPath: "/",
    chunkFilename: "[name].js?v=[chunkhash]",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: "css-loader",
            options: {
              // Keep absolute site paths like /loader.png as-is (served from static/)
              url: {
                filter: url => !url.startsWith("/"),
              },
            },
          },
        ],
      },
      {
        test: /\.(png|jpg|gif|woff2?|ttf|svg|otf|eof)$/,
        type: "asset/resource",
        generator: {
          filename: "s~[hash][ext]",
        },
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: "[name].css",
    }),
    new HashPlugin(),
  ],
  devtool: "source-map",
  resolve: {
    modules: ["./", "node_modules"],
    alias: {
      localforage: "node_modules/localforage/dist/localforage.nopromises.js",
    },
    fallback: {
      // Browser builds of mobi/sax pull node stream; not needed in the browser.
      stream: false,
    },
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          ecma: 10,
        },
      }),
      new CssMinimizerPlugin({
        minimizerOptions: {
          preset: [
            "default",
            {
              discardComments: { removeAll: true },
            },
          ],
        },
      }),
    ],
  },
};
