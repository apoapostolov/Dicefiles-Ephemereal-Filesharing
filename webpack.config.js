"use strict";

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const {RawSource} = require("webpack-sources");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const OptimizeCSSAssetsPlugin = require("optimize-css-assets-webpack-plugin");

function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  catch (ex) {
    return fallback;
  }
}

function mergeProviders(base, local) {
  const out = Object.assign({}, base || {});
  for (const [k, v] of Object.entries(local || {})) {
    out[k] = Object.assign({}, out[k] || {}, v || {});
  }
  return out;
}

const baseGifProviders = readJSON(path.join(__dirname, "core", "gif-providers.json"), {});
const localGifProviders = readJSON(path.join(__dirname, ".gif-providers.local.json"), {});
const mergedGifProviders = mergeProviders(baseGifProviders, localGifProviders);

class HashPlugin {
  apply(compiler) {
    compiler.hooks.emit.tap("HashPlugin", compilation => {
      const d = crypto.createHmac("sha224", "dicefiles");
      for (const a of Object.values(compilation.assets)) {
        try {
          d.update(a.source());
        }
        catch (ex) {
          console.error(ex);
        }
      }
      compilation.assets["../lib/clientversion.js"] =
        new RawSource(`module.exports = '${d.digest("hex").slice(0, 10)}';`);
    });
  }
}

module.exports = {
  mode: "development",
  context: path.join(__dirname, "entries"),
  entry: {
    client: "./main.js",
    register: "./register.js",
    account: "./account.js",
    user: "./user.js",
    sortable: "./sortable.js",
    style: "./css/style.css",
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
          "css-loader"
        ]
      },
      {
        test: /\.(png|jpg|gif|woff2?|ttf|svg|otf|eof)$/,
        use: [
          {
            loader: "file-loader",
            options: {
              name: "s~[hash].[ext]",
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: "[name].css"
    }),
    new webpack.DefinePlugin({
      __GIF_PROVIDERS__: JSON.stringify(mergedGifProviders),
    }),
    new HashPlugin(),
  ],
  devtool: "source-map",
  resolve: {
    modules: [
      "./",
      "node_modules",
    ],
    alias: {
      localforage: "node_modules/localforage/dist/localforage.nopromises.js",
    }
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          ecma: 10,
        },
      }),
      new OptimizeCSSAssetsPlugin({
        cssProcessor: require("cssnano"),
        cssProcessorOptions: {
          preset: "default",
          discardComments: { removeAll: true },
        },
      })
    ]
  },
};
