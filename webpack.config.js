const path = require("path");

module.exports = (env) => ({
  entry: {
    webview: "./src/webview/index.ts"
  },
  mode: (env.prod) ? "production" : "development",
  optimization: {
    minimize: env.prod ? true : false // Debugger has trouble if you minify, even with the source map.
  },
  output: {
    path: path.resolve(__dirname, "dist", "webview"),
    filename: "[name].js"
  },
  devtool: "eval-source-map",
  resolve: {
    extensions: [".js", ".ts", ".tsx"]
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        loader: "ts-loader",
        options: {
          configFile: "tsconfig.webview.json",
        }
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: "style-loader"
          },
          {
            loader: "css-loader"
          }
        ]
      }
    ]
  }
});
