import BaseStrategy from "./BaseStrategy.js";
import BaseProvider from "../providers/BaseProvider.js";

export default class BaseArbitrage extends BaseStrategy {
    _baseCurrency;
    _profitCurrencyPreferences;
    _marketCaches;
    _paperTradingEnabled;
    _recentPaperTrades;
    _minTradeSizeBaseCurrency;

    constructor(connectors, args, paperTradingMongoCollection) {
        super(connectors, args, paperTradingMongoCollection);

        this._baseCurrency = args.baseCurrency.toUpperCase();
        this._profitCurrencyPreferences = [];
        this._marketCaches = {};
        this._recentPaperTrades = [];

        if (args.profitCurrencyPreferences) {
            for (const [connector, choice] of Object.entries(args.profitCurrencyPreferences)) {
                this._profitCurrencyPreferences[connector] = choice;
            }
        } else {
            for (const connector of this._connectors) {
                this._profitCurrencyPreferences[connector._name] = true;
            }
        }

        this._paperTradingEnabled = args.enablePaperTrade ?? false;
        this._minTradeSizeBaseCurrency = args.minTradeSize ?? 100;
    }

    /**
     * Query whether profit should be kept as a reference currency for the specified connector
     * @param {string} connector Connector name to check
     * @returns {boolean} reference currency profit choice
     */
    keepProfitAsReferenceCurrency(connector) {
        return this._profitCurrencyPreferences[connector];
    }

    /**
     * Get markets and price info for all baseCurrency pairs
     * @param {BaseProvider} connector Connector used to query price info for RTM markets
     * @returns {Promise<{baseCurrency: string,referenceCurrency: string,success:true,sellPrice:number,sellDepth:number,buyPrice:number,buyDepth:number}[]>}
     */
    async baseCurrencyMarketPriceInfoForConnector(connector) {
        return await Promise.all(await this.connectorMarkets(connector._name).filter(x => x.baseCurrency === this._baseCurrency).map(async x => {
            return {
                baseCurrency: x.baseCurrency,
                referenceCurrency: x.referenceCurrency,
                ...(await connector.getMarketPrice(x.referenceCurrency, x.baseCurrency))
            };
        }))
    }

    /**
     * Get markets and price info for all baseCurrency pairs
     * @param {BaseProvider} connector Connector used to query price info for RTM markets
     * @returns {Promise<{baseCurrency: string,referenceCurrency: string,success:true,bid:{price:number,amount:number}[],ask:{price:number,amount:number}[]}[]>}
     */
    async baseCurrencyOrberBookInfosForConnector(connector) {
        return await Promise.all(await this.connectorMarkets(connector._name).filter(x => x.baseCurrency === this._baseCurrency).map(async x => {
            return {
                baseCurrency: x.baseCurrency,
                referenceCurrency: x.referenceCurrency,
                ...(await connector.getOrderBook(x.baseCurrency, x.referenceCurrency))
            };
        }))
    }

    /**
     * Store all the markets for each exchange for future use
     */
    async populateMarketCaches() {
        for (const connector of this._connectors) {
            this._marketCaches[connector._name] = await connector.getAllMarkets();
        }
    }

    /**
     * Check the balance of a currency in a specified exchange
     * @param {BaseProvider} connector Connector for the exchange we're checking the balance of
     * @param {string} currency Currency to query the balance for
    */
    async currencyBalance(connector, currency) {
        return await connector.getBalance(currency.toUpperCase());
    }

    connectorMarkets(connectorName) {
        return this._marketCaches[connectorName];
    }

    /**
     * Save trade data as a recent trade
     * @param {object} tradeObj
     */
    addToRecentPaperTrades(tradeObj) {
        this._recentPaperTrades.push(JSON.stringify({timestamp: Date.now(), uniqueMetadata: {...tradeObj}}));
    }

    /**
     * Determine whether a trade has already happened recently and is thus a duplicate
     * @param {object} tradeObj 
     * @returns {boolean}
     */
    isRecentTrade(tradeObj) {
        const tradeJson = JSON.stringify(tradeObj);

        for (const recentTrade of this._recentPaperTrades) {
            if (JSON.stringify(recentTrade.uniqueMetadata) === tradeJson) return true
        }

        return false;
    }

    /**
     * Remove recent paper trades that are older than the pre-set cooldown (60 seconds)
     */
    pruneRecentTrades() {
        const currentTimestamp = Date.now()

        // currently a delay of 60 seconds
        this._recentPaperTrades = this._recentPaperTrades.filter(x => currentTimestamp - x.timestamp < 60000)
    }

    /**
     * Calculate the amount of coins that shifts the price by `this._maxPriceDropPct` % if all trades were to be executed
     * @param {BaseProvider} connector Connector for the exchange we're gathering depth from
     * @param {{ baseCurrency: string, referenceCurrency: string }} tradingPair Trading pair for which we're gathering depth for
     * @param {"bid" | "ask"} side Whether the depth is going to be calculated for the bid or ask side of the order books
     * @param {{bid: {price: number, amount: number}[], ask: {price: number, amount: number}[]}} orderBook order book to use for calculations instead of using the exchange connector's function
     * @returns {Promise<{amount: amount, relevantBookEntries: {price: number, amount: number}[]}>} amount of coins that can be covered
     */
    async calculateDepth(connector, tradingPair, side, orderBook = null) {
        if (!orderBook)
            orderBook = await connector.getOrderBook(tradingPair.baseCurrency, tradingPair.referenceCurrency);

        const currentSideMarketPrice = orderBook[side][0].price;
        const relevantBookEntries = [];
        let amount = 0;

        for (const bookEntry of orderBook[side]) {
            if (
                ((bookEntry.price / currentSideMarketPrice) < (1 - this._maxPriceDropPct / 100) && side === "bid") ||
                ((bookEntry.price / currentSideMarketPrice) > (1 + this._maxPriceDropPct / 100) && side === "ask")
            ) return { amount: amount, relevantBookEntries: relevantBookEntries };

            amount += bookEntry.amount;
            relevantBookEntries.push(bookEntry);
        }

        // fall-through in case the exchange is so illiquid or this._maxPriceDropPct is so unrealistic that we can trade out the entire order book side
        return { amount: amount, relevantBookEntries: relevantBookEntries };
    }

    /**
     * Find the shortest path from startingCurrency to endingCurrency
     * Algorithm partially from: https://chat.openai.com/share/f05d1e48-8140-4a35-a0da-bde79b5a5e0b
     * Tweaked to support this particular trading algorithm
     * @param {BaseProvider} connector Exchange for which we're finding the shortest path of
     * @param {string} startingCurrency Currency converting from
     * @param {string} endingCurrency Currency converting to
     */
    shortestCrossCurrencyPath(connector, startingCurrency, endingCurrency) {
        const tradingPairs = this.connectorMarkets(connector._name);

        // Create a graph representation of the trading pairs
        const graph = {};
        for (const pair of tradingPairs) {
            if (!graph[pair.referenceCurrency]) {
                graph[pair.referenceCurrency] = [];
            }
            graph[pair.referenceCurrency].push(pair.baseCurrency);

            if (!graph[pair.baseCurrency]) {
                graph[pair.baseCurrency] = [];
            }
            graph[pair.baseCurrency].push(pair.referenceCurrency);
        }

        // Initialize BFS queue
        const queue = [{ currency: startingCurrency, path: [startingCurrency] }];
        const visited = new Set();

        while (queue.length > 0) {
            const { currency, path } = queue.shift();
            visited.add(currency);

            // Check if we've reached the end currency
            if (currency === endingCurrency) {
                return path;
            }

            // Explore adjacent currencies
            for (const neighbor of graph[currency] || []) {
                if (!visited.has(neighbor)) {
                    const newPath = [...path, neighbor];
                    queue.push({ currency: neighbor, path: newPath });
                }
            }
        }

        // If there's no path between start and end currency, return null
        return null;
    }

    /**
     * Get effective price for one RTM in each cross-currency direction for use in determining if profitable trades exist
     * @param {BaseProvider} connector 
     * @param {string[]} path 
     * @param {boolean} buying 
     * @param {number} minimumRtmAmount Minimum order size, in RTM.
     * @returns {Promise<{effectiveRtmPrice:number,finalPrice:number,path:{baseCurrency:string,depth:number,price:number,referenceCurrency:string,referenceCurrencyInverted:boolean,minimumCoinsRequired:number|undefined}[]}>} path and price information
     */
    async effectiveReferencePrice(connector, path, buying, minimumRtmAmount = 0) {
        let effectiveRtmPrice;
        const pathAndPriceInfo = { path: [] };
        const takerFeeFactor = 1 + connector._takerFeePct / 100;

        for (let i = 0; i < path.length - 1; i++) {
            const nextTargetCurrency = path[i + 1];
            const currentTargetCurrency = path[i];

            // the path graph shows both sides are valid pairs
            // Ex: RTM-BTC and BTC-RTM are both valid pairs when representing pairs IRL, but only one is valid from the exchange's POV
            let referenceCurrencyInverted = false;

            let priceInfoInternal = await connector.getMarketPrice(nextTargetCurrency, currentTargetCurrency);
            if (!priceInfoInternal.success) {
                referenceCurrencyInverted = true;
                priceInfoInternal = await connector.getMarketPrice(currentTargetCurrency, nextTargetCurrency);
                if (!priceInfoInternal) {
                    Logger.warning("ClassicArbitrage", "multiCurrencyPriceScan", `Failed to get price info for ${currentTargetCurrency}-${nextTargetCurrency}`, this._socketBroadcaster);
                    return;
                }
            }

            const correctPrice = referenceCurrencyInverted ? priceInfoInternal.buyPrice : priceInfoInternal.sellPrice;
            // first ever loop run, so we're just initializing to the sell price of the currency we own
            if (!effectiveRtmPrice) {
                effectiveRtmPrice = correctPrice;
            }
            else {
                effectiveRtmPrice = effectiveRtmPrice * (correctPrice / effectiveRtmPrice) * takerFeeFactor;
            }

            pathAndPriceInfo.path.push({
                referenceCurrency: nextTargetCurrency,
                baseCurrency: currentTargetCurrency,
                price: correctPrice,
                depth: priceInfoInternal.sellDepth,
                referenceCurrencyInverted: referenceCurrencyInverted,
            });
        }

        const rtmPriceInfoInternal = await connector.getMarketPrice(path[path.length - 1], this._baseCurrency.toUpperCase());
        const marketPrice = (buying ? rtmPriceInfoInternal.buyPrice : rtmPriceInfoInternal.sellPrice);
        effectiveRtmPrice = effectiveRtmPrice * (marketPrice / effectiveRtmPrice) * takerFeeFactor;
        pathAndPriceInfo.effectiveRtmPrice = effectiveRtmPrice;
        pathAndPriceInfo.finalPrice = marketPrice;

        pathAndPriceInfo.path[pathAndPriceInfo.path.length - 1].minimumCoinsRequired = minimumRtmAmount * effectiveRtmPrice;

        return pathAndPriceInfo;
    }
}