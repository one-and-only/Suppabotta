# Suppabotta
RTM Arbitrage Bot using WSS + REST

## Installation Instructions
1. Install [Node.JS](https://nodejs.org/en/download) (tested on Node 16-20; Install latest whenever possible)
1. Install [MongoDB](https://www.mongodb.com/try/download/community)
1. Install [Redis](https://redis.io/docs/getting-started/installation/)
1. Clone this repository or download as Zip and extract somewhere you'll have access to
1. Open the directory you just downloaded in a terminal
1. Install this project's Node.JS dependencies with `npm i`
1. Create a `.env` file in the same directory using the following template, replacing the default values with ones for you:
    * Redis connection details and MongoDB port will likely be correct for your setup. Please change them otherwise.
```ini
# HTTPS server certificate and private key file path
SSL_CERT_PATH=cert.pem
SSL_KEY_PATH=key.pem

# MongoDB connection details
MONGODB_ADDRESS=localhost:27017
MONGODB_USER=Suppabotta
MONGODB_PASS=WeUseRTM
MONGODB_DATABASE=Suppabotta

# Redis connection details
REDIS_HOST=localhost
REDIS_PORT=6379

# HTTPS website port
EXPRESS_PORT=443

# File path where logs are stored
# comment out if you want logging to file disabled
# Logging to console will be enabled regardless
LOG_FILE_PATH=/home/ubuntu/Suppabotta/session.log

# Milliseconds between ticker maintenance executions (default 300000; 5 minutes)
TICKER_MAINTENANCE_INTERVAL=300000

# Database that stores paper trading order info
# Useful for market/profitability analysis from paper trading mode
PAPER_TRADING_MONGO_DATABASE=PaperTradingHistory
```
1. Run the bot using `node index.js`

## Want to Use Docker Instead?
1. Clone this repositpry and open in a terminal
1. `docker build --pull -t suppabotta:local .`
1. `docker run -it -v $(pwd):/app suppabotta:local`

## Adding Users for Trading
1. Navigate to the web interface using your browser to `https://localhost:EXPRESS_PORT/`
    * Replace EXPRESS_PORT with the port you chose in the .env file
1. Click on `Register` in the menus on the top of the page
1. Fill out the form, adding and removing exchanges you'd like to enable trading with, and submit

## Using the Trading Bot
1. Navigate to the web interface and click on `Trading Home` in the menus
1. Fill in the form under the `Start Trading` section
1. Click `Start Trading`. Applicable messages and status updates will begin to appear in the text block under the `Server Messages` section
1. To stop trading, click the `Stop Trading` button

## Custom Arguments
Use these arguments to customize the behavior of the trading algorithm. These arguments are passed in as JSON when [Using the Trading Bot](#using-the-trading-bot).
### Available Arguments
* `maxInvPct | float`: Maximum percent of currency balance that is available for use per trade. This argument is applicable to FloatingArbitrage.
    * NOTE: `ClassicArbitrage` and `TickerMaintenance` always execute at minimum order sizes.
* `profitCurrencyPreferences | object` (For debug use only): Controls whether profits should be stored as net RTM or another reference currency (Ex: USDT). This parameter applies to each exchange individually and all used exchanges must have a value in this object parameter. `true` means store as reference currency, `false` means keep profits as RTM. This argument is applicable to ClassicArbitrage. Example:
    ```json
    "profitCurrencyPreferences": {
        "TradeOgre": true,
        "Xeggex": true,
        "CoinEx": true
    }
    ```
* `disableCrossCurrency | boolean`: Disable cross-currency trading in all trading strategies (Ex: disable trading between Exchange A RTM-BTC and Exchange B RTM-USDT). This argument is applicable to ClassicArbitrage
* `inventoryDefinition | array`: This object defines the maximum amount of each currency that can be used in use at any one time on FloatingArbitrage trades. This argument must be present for every instance of FloatingArbitrage. Use the currency code to signify each coin. The following is the object format:
    ```json
    "inventoryDefinition": {
        "CoinEx": {
            "USDT": 1000,
            "BTC": 100
        },
        "TradeOgre": {
            "USDT": 500,
            "BTC": 50
        }
    }
    ```
*  `maxPriceDropPct | number`: Maximum price drop percentage that is acceptable when checking for depth and checking for whether a certain amount of coins is coverable on a specified exchange. Default value is `5` (%). This argument is applicable to FloatingArbitrage
* `baseCurrency | string`: The base currency that algorithmic trades are going to be occuring for. For example, in the RTM/USDT trading pair, RTM would be the base currency. Only one base currency can be used at any one time per trading algorithm run. Note that you can run multiple algorithm configurations at the same time, 1 in each browser tab.
* `enablePaperTrade | boolean`: Instead of executing trades using a user's real exchange balance, it logs profitable opportunities to the database for later analysis. This mode is usually used to scout prospective markets for profit
* `numCurveOrders | number`: Number of orders per market side that should be targetted in the FloatingArbitrage strategy