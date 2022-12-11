const path = require('path');

module.exports = (env) => ({
    target: 'node',
    mode: (env.prod) ? "production" : "development",
    devtool: (env.prod) ? 'source-map' : 'inline-source-map', // inline-source-map makes debugging work better.
    optimization: {
      minimize: env.prod ? true : false // Debugger has trouble if you minify, even with the source map.
    },
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]",
    },
    externals: {
        vscode: "commonjs vscode"
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{
                loader: 'ts-loader',
                options: {
                    configFile: path.resolve(__dirname, 'src/tsconfig.json'),
                }
            }]
        }]
    },
});
