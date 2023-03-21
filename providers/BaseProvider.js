export default class BaseProvider {
    _apiSecret;
    _apiKey;
    _apiUrl;
    _pendingTrades;
    _tradingPairs;
    _requestHelper;
    _balances;
    _makerFeePct;
    _takerFeePct;
    _rtmWithdrawalFee;
    _minTradeVolumes; // per trading pair

    constructor(apiSecret, apiKey, apiUrl, makerFeePct, takerFeePct, rtmWithdrawalFee, name) {
        this._apiSecret = apiSecret;
        this._apiKey = apiKey;
        this._apiUrl = apiUrl;
        this._pendingTrades = [];
        this._tradingPairs = {};
        this._balances = {};
        this._makerFeePct = makerFeePct;
        this._takerFeePct = takerFeePct;
        this._rtmWithdrawalFee = rtmWithdrawalFee;
        this._minTradeVolumes = {};
        this._name = name;
    }

    /**
     * Initialize things that need async/await
     * Init object like: `const connector = await (new Provider(...)).initialize()`
     */
    async initialize() {
        throw new Error("This method must be implemented");
    }

    /**
     * Initialize all of the trading pairs
     * @returns void
     */
    async allTradingPairs() {
        throw new Error("This method must be implemented");
    }

    /**
     * Get the exchange-formatted trading pair for a given coin
     * @param {string} coin coin to get the trading pair for
     * @returns {string | undefined} exchange-formatted trading pair
     */
    coinToExchangePair(coin) {
        return this._tradingPairs[coin.toUpperCase()].pair;
    }

    /**
     * 
     * @param {string} tradingPair Exchange-formatted trading pair
     * @returns {string | undefined} Coin the pair is associated to
     */
    exchangePairToCoin(tradingPair) {
        for (const coin in this._tradingPairs) {
            if (this._tradingPairs[coin].pair === tradingPair.pair) return coin;
        }
        return null;
    }

    /**
     * 
     * @param {string} coin reference currency
     * @returns number minimum trade volume for trading pair
     */
    minOrderSize(coin) {
        return this._minTradeVolumes[this.coinToExchangePair(coin)];
    }

    /**
     * Get the current market prices
     * Highest you can sell for
     * Lowest you can buy for
     * Prices measured in Sats
     * @param {string} referenceCurrency crypto which RTM is paired with. Ex: "BTC" (case insensitive)
     * @returns {{ success: true, sellPrice: number, sellDepth: number, buyPrice: number, buyDepth: number} | { success: false, error: string }} market price data
     */
    async getMarketPrice(referenceCurrency) {
        throw new Error("This method must be implemented.");
    }

    /**
     * Add a buy order to the books
     * @param {number} amountRtm Amount of RTM to buy
     * @param {number} price Price, in `referenceCurrency`, to buy each RTM for
     * @param {string} referenceCurrency currency buying RTM with
     * @returns {Promise<boolean>} success or failure
     */
    async addBuyOrder(amount, price, referenceCurrency) {
        throw new Error("This method must be implemented.");
    }

    /**
     * Add a sell order to the books
     * @param {number} amountRtm Amount of RTM to sell
     * @param {number} price Price, in `referenceCurrency`, to sell each RTM for
     * @param {string} referenceCurrency currency buying RTM with
     * @returns {Promise<boolean>} success or failure
     */
    async addSellOrder(amount, price, referenceCurrency) {
        throw new Error("This method must be implemented.");
    }

    /**
     * Cancel all pending orders
     * @returns {Promise<boolean>} success or failure
     */
    async cancelAllPending() {
        throw new Error("This method must be implemented.");
    }

    /**
     * Check whether there is an RTM trading pair available with the given reference currency
     * @param {string} referenceCurrency currency RTM is paired with
     * @returns {boolean} whether it exists or not
     */
    referenceCurrencyExists(referenceCurrency) {
        return referenceCurrency in this._tradingPairs;
    }

    /**
     * Check the status of an order
     * @param {string} orderId unique ID of the pending order
     * @returns {Promise<object>} order status
     */
    async orderStatus(orderId) {
        throw new Error("This method must be implemented.");
    }

    /**
     * Check the balance of a currency on your account
     * @param {string} currency currency for which to check the balance (case insensitive)
     * @returns {Promise<{ success: boolean, total: number, available: number } | { success: boolean, error: string }>} balance info for that currency
     */
    async getBalance(currency) {
        throw new Error("This method must be implemented.");
    }
}