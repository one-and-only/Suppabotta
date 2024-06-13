import Logger from "../Logger.js";
import BaseProvider from "../providers/BaseProvider.js";
import BaseArbitrage from "./BaseArbitrage.js";

import Bluebird from "bluebird";
const { map: promiseMap } = Bluebird;

/**
 * @typedef {Object} DepthEntry
 * @property {number} amount amount of coins at a depth level
 * @property {number} price price of the coins at a depth level
 */
/**
 * @typedef {DepthEntry} Order
 */

export default class ClassicArbitrageStrategy extends BaseArbitrage {
    _alreadyProcessed;
    _disableCrossCurrency;

    /**
     * @param {BaseProvider[]} connectors 
     * @param {any} args 
     */
    constructor(connectors, args, paperTradingMongoCollection) {
        super(connectors, args, paperTradingMongoCollection);
        this._alreadyProcessed = [];
        this._disableCrossCurrency = false;

        if (args.disableCrossCurrency) this._disableCrossCurrency = args.disableCrossCurrency;
    }

    /**
     * Checks if the combination of connectors and trading pairs has been processed
     * Aids in removing redundant price scans
     * @param {{ connector: string, tradingPair: { referenceCurrency: string, baseCurrency: string } }} connector1AndPair
     * @param {{ connector: string, tradingPair: { referenceCurrency: string, baseCurrency: string } }} connector2AndPair
     */
    comboAlreadyProcessed(connector1AndPair, connector2AndPair) {
        for (const combo of this._alreadyProcessed) {
            if (
                combo[connector1AndPair.connector] &&
                combo[connector1AndPair.connector].referenceCurrency === connector1AndPair.tradingPair.referenceCurrency &&
                combo[connector1AndPair.connector].baseCurrency === connector1AndPair.tradingPair.baseCurrency &&
                combo[connector2AndPair.connector] &&
                combo[connector2AndPair.connector].referenceCurrency === connector2AndPair.tradingPair.referenceCurrency &&
                combo[connector2AndPair.connector].baseCurrency === connector2AndPair.tradingPair.baseCurrency
            ) return;

            if (
                combo[connector2AndPair.connector] &&
                combo[connector2AndPair.connector].referenceCurrency === connector1AndPair.tradingPair.referenceCurrency &&
                combo[connector2AndPair.connector].baseCurrency === connector1AndPair.tradingPair.baseCurrency &&
                combo[connector1AndPair.connector] &&
                combo[connector1AndPair.connector].referenceCurrency === connector2AndPair.tradingPair.referenceCurrency &&
                combo[connector1AndPair.connector].baseCurrency === connector2AndPair.tradingPair.baseCurrency
            ) return;
        }

        return false;
    }

    /**
     * Mark a connector and trading pair combination as processed
     * Identifies redundant processing of trading pairs
     * @param {BaseProvider[]} connectors
     * @param {{ referenceCurrency: string, baseCurrency: string }} tradingPair1
     * @param {{ referenceCurrency: string, baseCurrency: string }} tradingPair2
     */
    markAsProcessed(connectors, tradingPair1, tradingPair2) {
        const combo = {};
        combo[connectors[0]] = { referenceCurrency: tradingPair1.referenceCurrency, baseCurrency: tradingPair1.baseCurrency };
        combo[connectors[1]] = { referenceCurrency: tradingPair2.referenceCurrency, baseCurrency: tradingPair2.baseCurrency };
        this._alreadyProcessed.push(combo);
    }

    /**
     * 
     * @param {string} buyingFrom 
     * @param {string} sellingOn 
     * @param {string} baseCurrency 
     * @param {string} referenceCurrency 
     * @param {number} buyPrice 
     * @param {number} buyAmount 
     * @param {number} sellPrice 
     * @param {number} sellAmount 
     * @returns 
     */
    sameCurrencyPaperTradeFromInfo(buyingFrom, sellingOn, baseCurrency, referenceCurrency, buyPrice, buyAmount, sellPrice, sellAmount) {
        return {
            buyingFrom: buyingFrom,
            sellingOn: sellingOn,
            pair: {
                baseCurrency: baseCurrency,
                referenceCurrency: referenceCurrency,
            },
            buyTrade: {
                price: buyPrice,
                amount: buyAmount
            },
            sellTrade: {
                price: sellPrice,
                amount: sellAmount
            }
        };
    }

    async start() {
        Logger.info("ClassicArbitrage", "startup", "Caching connector info required for trading...", true, this._redisConnection, this._jobId);
        await this.populateMarketCaches();
        Logger.info("ClassicArbitrage", "startup", "Startup complete and trading started!", true, this._redisConnection, this._jobId);
    }

    /**
     * Gather same pair arbitrage orders that can be used to fulfill profitable trades
     * @param {Order[]} currentOrderBookInfo `currentConnector` order book for the applicable market
     * @param {Order[]} otherOrderBookInfo `otherConnector` order book for the applicable market
     * @param {number} currentMinOrderSize minimum order size on `currentConnector` for the applicable market
     * @param {number} otherMinOrderSize minimum order size on `otherConnector` for the applicable market
     * @param {boolean} direction `true` when buying on `currentConnector` and `false` when buying on `otherConnector`
     * @returns {{buyOrders: Order[], sellOrders: Order[], profitable: boolean, numTimesRepeatable: number, profitFactor: number}}
     */
    gatherEffectiveArbitrageOrders(currentOrderBookInfo, otherOrderBookInfo, currentMinOrderSize, otherMinOrderSize, direction) {
        const effectiveMinOrderSize = Math.max(currentMinOrderSize, otherMinOrderSize);
        const minimumBuyingOrderSize = Math.max(direction ? currentMinOrderSize : otherMinOrderSize, this._minTradeSizeBaseCurrency);
        const minimumSellingOrderSize = Math.max(direction ? otherMinOrderSize : currentMinOrderSize, this._minTradeSizeBaseCurrency);

        const buyingOrderBook = direction ? currentOrderBookInfo : otherOrderBookInfo;
        const sellingOrderBook = direction ? otherOrderBookInfo : currentOrderBookInfo;

        if (buyingOrderBook.ask.length == 0 || sellingOrderBook.bid.length == 0) {
            Logger.warning("ClassicArbitrage", "gatherOrders", "One of the given order books are empty", true, this._redisConnection, this._jobId);
            return {
                buyOrders: [],
                sellOrders: [],
                profitable: false,
                numTimesRepeatable: 0,
                profitFactor: -1
            };
        }

        let coinsCollected = 0;
        const buyupOrders = [];
        let buyupCounter = -1;
        while (coinsCollected < effectiveMinOrderSize && (buyupCounter + 1) < buyingOrderBook.ask.length) {
            buyupCounter++;

            const coinsNeeded = effectiveMinOrderSize - coinsCollected;
            const nearestBuyOrder = buyingOrderBook.ask[buyupCounter];

            // this means that at this price level there is only "dust" left that we can't buy
            if (nearestBuyOrder?.amount < minimumBuyingOrderSize) continue;

            const buyingAmount = coinsNeeded < nearestBuyOrder.amount ? coinsNeeded : nearestBuyOrder.amount;
            coinsCollected += buyingAmount;

            buyupOrders.push({ price: nearestBuyOrder.price, amount: buyingAmount });
        }

        if (coinsCollected < effectiveMinOrderSize) {
            return {
                buyOrders: [],
                sellOrders: [],
                profitable: false,
                numTimesRepeatable: 0,
                profitFactor: -1
            }
        }

        const sellOrders = [];
        let sellOrderCounter = -1;
        let coinsSold = 0;

        while (coinsSold < coinsCollected && (sellOrderCounter + 1) < sellingOrderBook.bid.length) {
            sellOrderCounter++;
            
            const coinsNeeded = coinsCollected - coinsSold;
            const nearestSellOrder = sellingOrderBook.bid[sellOrderCounter];

            // this means that at this price level there is only "dust" left that we can't sell
            if (nearestSellOrder?.amount < minimumSellingOrderSize) continue;

            const sellingAmount = coinsNeeded < nearestSellOrder.amount ? coinsNeeded : nearestSellOrder.amount;
            coinsSold += sellingAmount;

            sellOrders.push({ price: nearestSellOrder.price, amount: sellingAmount });
        }

        if (coinsSold < coinsCollected) {
            return {
                buyOrders: [],
                sellOrders: [],
                profitable: false,
                numTimesRepeatable: 0,
                profitFactor: -1
            };
        }

        console.assert(buyupOrders.length > 0, `buyupOrders length is zero, ${coinsCollected} ${effectiveMinOrderSize} ${coinsSold} ${coinsCollected}`);
        console.assert(sellOrders.length > 0, `sellOrders length is zero, ${coinsCollected} ${effectiveMinOrderSize} ${coinsSold} ${coinsCollected}`);
        const buyingCost = buyupOrders.map(x => x.amount * x.price).reduce((acc, curr) => acc += curr);
        const sellingRevenue = sellOrders.map(x => x.amount * x.price).reduce((acc, curr) => acc += curr);

        return {
            buyOrders: buyupOrders,
            sellOrders: sellOrders,
            profitable: (sellingRevenue / buyingCost) >= 1.01, // target at least 1% profit
            numTimesRepeatable: 1,
            profitFactor: sellingRevenue / buyingCost
        };
    }

    async tick() {
        this.pruneRecentPaperTrades();

        for (const currentConnector of this._connectors) {
            const currentBaseCurrencyOrderBookInfos = await this.baseCurrencyOrderBookInfosForConnector(currentConnector);

            for (const currentBaseCurrencyOrderBookInfo of currentBaseCurrencyOrderBookInfos) {
                for (const otherConnector of this._connectors) {
                    if (currentConnector._name === otherConnector._name) continue;

                    const otherBaseCurrencyOrderBookInfos = await this.baseCurrencyOrderBookInfosForConnector(otherConnector);

                    for (const otherBaseCurrencyOrderBookInfo of otherBaseCurrencyOrderBookInfos) {
                        if (this.comboAlreadyProcessed({ connector: currentConnector._name, tradingPair: currentBaseCurrencyOrderBookInfo }, { connector: otherConnector._name, tradingPair: otherBaseCurrencyOrderBookInfo })) continue;
                        this.markAsProcessed([currentConnector._name, otherConnector._name], currentBaseCurrencyOrderBookInfo, otherBaseCurrencyOrderBookInfo);

                        if (otherBaseCurrencyOrderBookInfo.referenceCurrency === currentBaseCurrencyOrderBookInfo.referenceCurrency) {
                            const currentEffectiveBuyPrice = currentBaseCurrencyOrderBookInfo.ask[0]?.price;
                            const otherEffectiveBuyPrice = otherBaseCurrencyOrderBookInfo.ask[0]?.price;

                            const currentMinOrderSize = currentConnector.minOrderSize(this._baseCurrency, currentBaseCurrencyOrderBookInfo.referenceCurrency);
                            const otherMinOrderSize = otherConnector.minOrderSize(this._baseCurrency, otherBaseCurrencyOrderBookInfo.referenceCurrency);

                            const currentMinOrderSizeBaseCurrency = Math.max(currentConnector.minTradeVolumeIsReferenceCurrency() ? currentMinOrderSize / currentEffectiveBuyPrice : currentMinOrderSize, this._minTradeSizeBaseCurrency);
                            const otherMinOrderSizeBaseCurrency = Math.max(otherConnector.minTradeVolumeIsReferenceCurrency() ? otherMinOrderSize / otherEffectiveBuyPrice : otherMinOrderSize, this._minTradeSizeBaseCurrency);

                            const buyFromCurrentOrders = this.gatherEffectiveArbitrageOrders(currentBaseCurrencyOrderBookInfo, otherBaseCurrencyOrderBookInfo, currentMinOrderSizeBaseCurrency, otherMinOrderSizeBaseCurrency, true);
                            const buyFromOtherOrders = this.gatherEffectiveArbitrageOrders(currentBaseCurrencyOrderBookInfo, otherBaseCurrencyOrderBookInfo, currentMinOrderSizeBaseCurrency, otherMinOrderSizeBaseCurrency, false);
                            
                            console.assert((buyFromCurrentOrders.profitable && buyFromCurrentOrders.profitFactor >= 1.01) || (!buyFromCurrentOrders.profitable && buyFromCurrentOrders.profitFactor < 1.01), `profitability boolean mismatch: ${buyFromCurrentOrders.profitFactor}`);
                            console.assert((buyFromOtherOrders.profitable && buyFromOtherOrders.profitFactor >= 1.01) || (!buyFromOtherOrders.profitable && buyFromOtherOrders.profitFactor < 1.01), `profitability boolean mismatch: ${buyFromOtherOrders.profitFactor}`);
                            if (buyFromCurrentOrders.profitable) {
                                if (this._paperTradingEnabled) {
                                    const tradeInfo = {
                                        pair: `${currentBaseCurrencyOrderBookInfo.referenceCurrency}-${currentBaseCurrencyOrderBookInfo.baseCurrency}`,
                                        buyingFrom: currentConnector._name,
                                        sellingOn: otherConnector._name,
                                        buyOrders: buyFromCurrentOrders.buyOrders,
                                        sellOrders: buyFromCurrentOrders.sellOrders
                                    };

                                    const recentTradeInfo = this.isRecentTrade(tradeInfo);
                                    if (recentTradeInfo.repeat) continue;

                                    if (recentTradeInfo.repeatNumber === 1) this.addToRecentPaperTrades(tradeInfo, buyFromCurrentOrders.numTimesRepeatable);

                                    this._paperTradingMongoCollection.insertOne({
                                        mongo_timestamp: new Date(),
                                        trade_metadata: {
                                            strategy: "ClassicArbitrage",
                                            cross_currency: false,
                                        },
                                        tradeInfo: tradeInfo
                                    });

                                    Logger.success("ClassicArbitrage", "tradeCompletion", "Found profitable paper trades and saved them to the database", true, this._redisConnection, this._jobId);
                                } else {
                                    await promiseMap(
                                        buyFromCurrentOrders.buyOrders,
                                        async order => {
                                            await currentConnector.addBuyOrder(order.amount, order.price, currentBaseCurrencyOrderBookInfo.referenceCurrency, currentBaseCurrencyOrderBookInfo.baseCurrency);
                                        }
                                    );

                                    await promiseMap(
                                        buyFromCurrentOrders.sellOrders,
                                        async order => {
                                            await otherConnector.addSellOrder(order.amount, order.price, currentBaseCurrencyOrderBookInfo.referenceCurrency, currentBaseCurrencyOrderBookInfo.baseCurrency);
                                        }
                                    );
                                }
                            }

                            if (buyFromOtherOrders.profitable) {
                                if (this._paperTradingEnabled) {
                                    const tradeInfo = {
                                        pair: `${currentBaseCurrencyOrderBookInfo.referenceCurrency}-${currentBaseCurrencyOrderBookInfo.baseCurrency}`,
                                        buyingFrom: otherConnector._name,
                                        sellingOn: currentConnector._name,
                                        buyOrders: buyFromOtherOrders.buyOrders,
                                        sellOrders: buyFromOtherOrders.sellOrders
                                    };

                                    const recentTradeInfo = this.isRecentTrade(tradeInfo);
                                    if (recentTradeInfo.repeat) continue;

                                    if (recentTradeInfo.repeatNumber === 1) this.addToRecentPaperTrades(tradeInfo, buyFromOtherOrders.numTimesRepeatable);

                                    this._paperTradingMongoCollection.insertOne({
                                        mongo_timestamp: new Date(),
                                        trade_metadata: {
                                            strategy: "ClassicArbitrage",
                                            cross_currency: false,
                                        },
                                        tradeInfo: tradeInfo
                                    });

                                    Logger.success("ClassicArbitrage", "tradeCompletion", "Found profitable paper trades and saved them to the database", true, this._redisConnection, this._jobId);
                                } else {
                                    await promiseMap(
                                        buyFromOtherOrders.buyOrders,
                                        async order => {
                                            await otherConnector.addBuyOrder(order.amount, order.price, currentBaseCurrencyOrderBookInfo.referenceCurrency, currentBaseCurrencyOrderBookInfo.baseCurrency);
                                        }
                                    );

                                    await promiseMap(
                                        buyFromOtherOrders.sellOrders,
                                        async order => {
                                            await currentConnector.addSellOrder(order.amount, order.price, currentBaseCurrencyOrderBookInfo.referenceCurrency, currentBaseCurrencyOrderBookInfo.baseCurrency);
                                        }
                                    );
                                }
                            }
                        } else {
                            continue;
                            /**
                             * 
                             * @param {BaseProvider} currentConnector 
                             * @param {BaseProvider} otherConnector 
                             */
                            const processCrossCurrency = async (currentConnector, otherConnector) => {
                                const potentialMarket = this._marketCaches[currentConnector._name].filter(x => x.baseCurrency === currentBaseCurrencyOrderBookInfo.baseCurrency && x.referenceCurrency === currentBaseCurrencyOrderBookInfo.referenceCurrency);
                                if (potentialMarket.length === 0) return;
                                console.assert(potentialMarket.length === 1, `Cross currency exchange market possibilities are not unique (${potentialMarket.length} > 1)`);

                                const crossExchangeMarket = potentialMarket[0];
                                const crossExchangePriceInfo = await currentConnector.getMarketPrice(crossExchangeMarket.referenceCurrency, crossExchangeMarket.baseCurrency);

                                const potentialRtmMarketCurrentConnector = this._marketCaches[currentConnector._name].filter(x => x.baseCurrency === otherBaseCurrencyOrderBookInfo.baseCurrency && x.referenceCurrency === otherBaseCurrencyOrderBookInfo.referenceCurrency);
                                if (potentialRtmMarketCurrentConnector.length === 0) {
                                    console.log(`${JSON.stringify(otherBaseCurrencyOrderBookInfo.baseCurrency + "-" + otherBaseCurrencyOrderBookInfo.referenceCurrency)} not a valid pair on ${currentConnector._name}`);
                                    return;
                                }

                                console.assert(potentialRtmMarketCurrentConnector.length === 1, "Found more than one related markets for cross currency");
                                const baseCurrencyMarketCurrenctConnector = potentialRtmMarketCurrentConnector[0];
                                const baseCurrencyMarketCurrentConnectorPriceInfo = await currentConnector.getMarketPrice(baseCurrencyMarketCurrenctConnector.referenceCurrency, baseCurrencyMarketCurrenctConnector.baseCurrency);

                                const samePairCurrentPriceInfo = await currentConnector.getMarketPrice(otherBaseCurrencyOrderBookInfo.referenceCurrency, otherBaseCurrencyOrderBookInfo.baseCurrency);
                                console.assert(samePairCurrentPriceInfo.success, "Failed to get same pair current price info in cross currency");

                                const minimumCrossExchangeTradeSize = currentConnector.minOrderSize(crossExchangeMarket.baseCurrency, crossExchangeMarket.referenceCurrency);
                                console.assert(minimumCrossExchangeTradeSize >= 0, `Failed to get minimum trade size for ${currentConnector._name} | ${currentConnector.coinsToExchangePair([crossExchangeMarket.baseCurrency, crossExchangeMarket.referenceCurrency])}`);

                                const minimumCrossExchangeTradeSizeIntermediary = currentConnector.minTradeVolumeIsReferenceCurrency() ? minimumCrossExchangeTradeSize / crossExchangePriceInfo.buyPrice : minimumCrossExchangeTradeSize;
                                const minimumCrossExchangeTradeSizeBaseCurrency = minimumCrossExchangeTradeSizeIntermediary / baseCurrencyMarketCurrentConnectorPriceInfo.buyPrice;
                                console.log(minimumCrossExchangeTradeSizeBaseCurrency);
                            }

                            await processCrossCurrency(currentConnector, otherConnector);
                        }
                    }
                }
            }
        }

        this._alreadyProcessed = [];
    }

    async shutdown() {
        Logger.info("ClassicArbitrage", "shutdown", "Trading algorithm stopped", true, this._redisConnection, this._jobId);
    }
}