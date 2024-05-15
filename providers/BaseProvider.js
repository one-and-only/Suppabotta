export default class BaseProvider {
    _outboundIp;
    _apiSecret;
    _apiKey;
    _apiUrl;
    _tradingPairs;
    _requestHelper;
    _makerFeePct;
    _takerFeePct;
    _baseCurrencyWithdrawalFee;
    _minTradeVolumes;
    _minTradeVolumeIsReferenceCurrency;
    _exchangeApiPairCurrencyOrder;
    _exchangeApiCurrencySeparator;
    _name;
    _baseCurrency;
    _requestHelper;

    /**
     * Base class for an exchange provider (Exchange API interface)
     * @param {string} outboundIp IP that should be used for all outbound requests. Useful for bypassing IP-based API rate limits when you have multiple public IPs
     * @param {string} apiSecret Private API key
     * @param {string} apiKey Public API key
     * @param {string} apiUrl Exchange API base URL
     * @param {string} baseCurrency Base currency to use for initialization
     * @param {number} makerFeePct Exchange maker fee (%)
     * @param {number} takerFeePct Exchange taker fee (%)
     * @param {number} baseCurrencyWithdrawalFee Exchange withdrawal fee for `baseCurrency`
     * @param {boolean} minTradeVolumeIsReferenceCurrency Whether the minimum trade volume is measured in `baseCurrency` or `referenceCurrency`
     * @param {[number, number]} exchangeApiPairCurrencyOrder This array controls whether the referenceCurrency or baseCurrency is inserted first when formatting coins into an exchange trading pair
     * @param {string} exchangeApiCurrencySeparator Separator between the referenceCurrency and baseCurrency in the exchange API
     * @param {string} name Name/unique identifier of the exchange provider
     */
    constructor(outboundIp, requestHelper, apiSecret, apiKey, apiUrl, baseCurrency, makerFeePct, takerFeePct, baseCurrencyWithdrawalFee, minTradeVolumeIsReferenceCurrency, exchangeApiPairCurrencyOrder, exchangeApiCurrencySeparator, name) {
        this._outboundIp = outboundIp;
        this._requestHelper = requestHelper;
        this._apiSecret = apiSecret;
        this._apiKey = apiKey;
        this._apiUrl = apiUrl;
        this._baseCurrency = baseCurrency;
        this._tradingPairs = {};
        this._makerFeePct = makerFeePct;
        this._takerFeePct = takerFeePct;
        this._baseCurrencyWithdrawalFee = baseCurrencyWithdrawalFee;
        this._minTradeVolumes = {};
        this._minTradeVolumeIsReferenceCurrency = minTradeVolumeIsReferenceCurrency;
        this._exchangeApiPairCurrencyOrder = exchangeApiPairCurrencyOrder;
        this._exchangeApiCurrencySeparator = exchangeApiCurrencySeparator;
        this._name = name;
    }

    minTradeVolumeIsReferenceCurrency() {
        return this._minTradeVolumeIsReferenceCurrency;
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
     * Format base and reference currency into an exchange API-compatible trading pair
     * @param {string[]} coins coins to format in the order of [baseCurrency, referenceCurrency]
     * @returns {string} exchange API-formatted string representing a trading pair
     */
    coinsToExchangePair(coins) {
        return `${coins[this._exchangeApiPairCurrencyOrder[0]]}${this._exchangeApiCurrencySeparator}${coins[this._exchangeApiPairCurrencyOrder[1]]}`;
    }

    /**
     * Get the minimum order size for a given market
     * @param {string} baseCurrency base currency
     * @param {string} referenceCurrency reference currency
     * @returns {number} minimum trade volume for trading pair
     */
    minOrderSize(baseCurrency, referenceCurrency) {
        return this._minTradeVolumes[this.coinsToExchangePair([baseCurrency, referenceCurrency])];
    }

    /**
     * Get all of the markets available for trading on an exchange
     * @returns {Promise<{referenceCurrency: string, baseCurrency: string}[]>} markets
     */
    async getAllMarkets() {
        throw new Error("This method must be implemented");
    }

    /**
     * Get the full order book for a specified trading pair (`baseCurrency` and `referenceCurrency`)
     * @param {string} baseCurrency
     * @param {string} referenceCurrency
     * @returns {Promise<{bid: {price: number, amount: number}[], ask: {price: number, amount: number}[]}>}
     */
    async getOrderBook(baseCurrency, referenceCurrency) {
        throw new Error("This method must be implemented");
    }

    /**
     * Get the current market prices
     * Highest you can sell for
     * Lowest you can buy for
     * @param {string} referenceCurrency crypto which `baseCurrency` is paired with. Ex: "BTC" (case insensitive)
     * @returns {Promise<{ success: true, sellPrice: number, sellDepth: number, buyPrice: number, buyDepth: number} | { success: false, error: string }>} market price data
     */
    async getMarketPrice(referenceCurrency, baseCurrency) {
        throw new Error("This method must be implemented.");
    }

    /**
     * Add a buy order to the books
     * @param {number} baseAmount Amount of `baseCurrency` to buy
     * @param {number} price Price, in `referenceCurrency`, to buy each `baseCurrency` for
     * @param {string} referenceCurrency currency buying `baseCurrency` with
     * @param {string} baseCurrency `baseCurrency`
     * @returns {Promise<{ success: boolean, id: string }>} success or failure
     */
    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        throw new Error("This method must be implemented.");
    }

    /**
     * Add a sell order to the books
     * @param {number} baseAmount Amount of `baseCurrency` to sell
     * @param {number} price Price, in `referenceCurrency`, to sell each `baseCurrency` for
     * @param {string} referenceCurrency currency buying `baseCurrency` with
     * @param {string} baseCurrency `baseCurrency`
     * @returns {Promise<{ success: boolean, id: string }>} success or failure
     */
    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        throw new Error("This method must be implemented.");
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
     * @returns {Promise<{ success: true, total: number, available: number } | { success: false, error: string }>} balance info for that currency
     */
    async getBalance(currency) {
        throw new Error("This method must be implemented.");
    }
}