import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default [
  { ignores: ["static/**", "uploads/**", "views/**", "contrib/**", "core/**", "images/**", "node_modules/**", "coverage/**", "output/**", ".config", ".config.json", "lib/clientversion.js"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    plugins: { "@stylistic": stylistic },
    rules: { ...js.configs.recommended.rules, "no-useless-assignment": "off", "preserve-caught-error": "off", ...{
      "max-len": 0,
      "max-depth": [
        "error",
        7
      ],
      "curly": [
        "error",
        "all"
      ],
      "@stylistic/brace-style": [
        "error",
        "stroustrup"
      ],
      "no-console": 0,
      "no-unused-vars": [
        "error",
        {
          vars: "local",
          caughtErrors: "none",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_+|^dummy"
        }
      ],
      "@stylistic/indent": [
        "error",
        2,
        {
          SwitchCase: 0,
          flatTernaryExpressions: true,
          VariableDeclarator: 2,
          outerIIFEBody: 0,
          MemberExpression: 1,
          FunctionDeclaration: {
            body: 1,
            parameters: 2
          },
          FunctionExpression: {
            body: 1,
            parameters: 2
          },
          CallExpression: {
            arguments: 1
          },
          ArrayExpression: 1,
          ObjectExpression: 1
        }
      ],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/no-multi-spaces": "error",
      "@stylistic/key-spacing": [
        "error",
        {
          mode: "strict",
          beforeColon: false,
          afterColon: true
        }
      ],
      "@stylistic/keyword-spacing": [
        "error",
        {
          before: true
        }
      ],
      "@stylistic/space-infix-ops": "error",
      "@stylistic/space-unary-ops": "error",
      "@stylistic/no-mixed-spaces-and-tabs": "error",
      "accessor-pairs": "error",
      "no-template-curly-in-string": "error",
      "array-callback-return": "error",
      "block-scoped-var": "error",
      "consistent-return": 0,
      "@stylistic/dot-location": [
        "error",
        "object"
      ],
      "dot-notation": "error",
      "eqeqeq": [
        "error",
        "smart"
      ],
      "no-else-return": "error",
      "no-eval": "error",
      "@stylistic/no-floating-decimal": "error",
      "no-implied-eval": "error",
      "no-lone-blocks": "error",
      "no-new-func": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-with": "error",
      "radix": "error",
      "require-await": "off",
      "@stylistic/block-spacing": "error",
      "@stylistic/eol-last": [
        "error",
        "always"
      ],
      "@stylistic/comma-dangle": [
        "error",
        "only-multiline"
      ],
      "@stylistic/comma-spacing": [
        "error",
        {
          before: false,
          after: true
        }
      ],
      "@stylistic/comma-style": [
        "error",
        "last"
      ],
      "func-name-matching": "error",
      "@stylistic/function-call-spacing": [
        "error",
        "never"
      ],
      "@stylistic/computed-property-spacing": [
        "error",
        "never"
      ],
      "yoda": "error",
      "no-undefined": 0,
      "new-cap": ["error", { properties: false }],
      "@stylistic/new-parens": "error",
      "no-lonely-if": "error",
      "@stylistic/no-tabs": "error",
      "one-var": [
        "error",
        "never"
      ],
      "operator-assignment": [
        "error",
        "always"
      ],
      "@stylistic/operator-linebreak": [
        "error",
        "after"
      ],
      "@stylistic/padded-blocks": [
        "error",
        "never"
      ],
      "@stylistic/quote-props": [
        "error",
        "consistent-as-needed"
      ],
      "@stylistic/linebreak-style": [
        "error",
        "unix"
      ],
      "@stylistic/quotes": [
        "error",
        "double"
      ],
      "@stylistic/semi": [
        "error",
        "always"
      ],
      "@stylistic/semi-spacing": "error",
      "@stylistic/semi-style": [
        "error",
        "last"
      ],
      "@stylistic/space-before-blocks": "error",
      "@stylistic/space-in-parens": [
        "error",
        "never"
      ],
      "@stylistic/arrow-parens": [
        "error",
        "as-needed"
      ],
      "@stylistic/arrow-spacing": "error",
      "@stylistic/generator-star-spacing": [
        "error",
        {
          before: true,
          after: false
        }
      ],
      "no-useless-computed-key": "error",
      "no-useless-constructor": "error",
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-const": "error",
      "prefer-destructuring": [
        "error",
        {
          array: false,
          object: true
        }
      ],
      "prefer-numeric-literals": "error",
      "prefer-rest-params": "error",
      "prefer-template": "error",
      "@stylistic/rest-spread-spacing": [
        "error",
        "never"
      ],
      "@stylistic/template-curly-spacing": "error",
      "@stylistic/yield-star-spacing": [
        "error",
        {
          before: true,
          after: false
        }
      ],
      "@stylistic/padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          prev: "*",
          next: [
            "class",
            "function",
            "case",
            "directive"
          ]
        },
        {
          blankLine: "never",
          prev: "directive",
          next: "directive"
        },
        {
          blankLine: "always",
          prev: [
            "class",
            "function",
            "directive",
            "cjs-import"
          ],
          next: "*"
        },
        {
          blankLine: "never",
          prev: "directive",
          next: "directive"
        },
        {
          blankLine: "never",
          prev: "cjs-import",
          next: "cjs-import"
        }
      ]
    } },
  },
  { files: ["tests/**/*.js"], languageOptions: { globals: globals.jest }, rules: { "require-await": "off" } },
];
