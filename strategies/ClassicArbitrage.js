import Logger from "../Logger.js";
import BaseProvider from "../providers/BaseProvider.js";
import BaseArbitrage from "./BaseArbitrage.js";

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
        Logger.info("ClassicArbitrage", "startup", "Caching connector info required for trading...", this._socketBroadcaster);
        await this.populateMarketCaches();
        Logger.info("ClassicArbitrage", "startup", "Startup complete and trading started!", this._socketBroadcaster);
    }

    async tick() {
        this.pruneRecentTrades();
        const paperTradeDetails = {
            currencyConversionPriceTransitions: {},
            arbitrageTrades: {},
        };

        for (const currentConnector of this._connectors) {
            const currentBaseCurrencyPriceInfos = await this.baseCurrencyMarketPriceInfoForConnector(currentConnector);

            for (const currentBaseCurrencyPriceInfo of currentBaseCurrencyPriceInfos) {
                for (const otherConnector of this._connectors) {
                    if (currentConnector._name === otherConnector._name) continue;

                    const otherBaseCurrencyPriceInfos = await this.baseCurrencyMarketPriceInfoForConnector(otherConnector);

                    for (const otherBaseCurrencyPriceInfo of otherBaseCurrencyPriceInfos) {
                        if (this.comboAlreadyProcessed({ connector: currentConnector._name, tradingPair: currentBaseCurrencyPriceInfo }, { connector: otherConnector._name, tradingPair: otherBaseCurrencyPriceInfo })) continue;
                        this.markAsProcessed([currentConnector._name, otherConnector._name], currentBaseCurrencyPriceInfo, otherBaseCurrencyPriceInfo);

                        if (otherBaseCurrencyPriceInfo.referenceCurrency === currentBaseCurrencyPriceInfo.referenceCurrency) {
                            continue;
                            const currentEffectiveBuyPrice = currentBaseCurrencyPriceInfo.buyPrice * (1 + currentConnector._takerFeePct / 100); // spending more than the value of the coin with fees
                            const currentEffectiveSellPrice = currentBaseCurrencyPriceInfo.sellPrice / (1 + currentConnector._takerFeePct / 100); // getting less money than the value of the coin with fees
                            const otherEffectiveBuyPrice = otherBaseCurrencyPriceInfo.buyPrice * (1 + otherConnector._takerFeePct / 100);
                            const otherEffectiveSellPrice = otherBaseCurrencyPriceInfo.sellPrice / (1 + otherConnector._takerFeePct / 100);

                            const currentMinOrderSize = currentConnector.minOrderSize(currentBaseCurrencyPriceInfo.referenceCurrency);
                            const otherMinOrderSize = otherConnector.minOrderSize(otherBaseCurrencyPriceInfo.referenceCurrency);

                            const currentMinOrderSizeBaseCurrency = Math.max(currentConnector.minTradeVolumeIsReferenceCurrency() ? currentMinOrderSize / currentBaseCurrencyPriceInfo.buyPrice : currentMinOrderSize, this._minTradeSizeBaseCurrency);
                            const otherMinOrderSizeBaseCurrency = Math.max(otherConnector.minTradeVolumeIsReferenceCurrency() ? otherMinOrderSize / otherBaseCurrencyPriceInfo.buyPrice : otherMinOrderSize, this._minTradeSizeBaseCurrency);

                            let effectiveMinOrderSize = currentMinOrderSizeBaseCurrency > otherMinOrderSizeBaseCurrency ? currentMinOrderSizeBaseCurrency : otherMinOrderSizeBaseCurrency;

                            // TODO: merge the order creation into one function to avoid repetition

                            if (currentEffectiveBuyPrice < otherEffectiveSellPrice) {
                                if (otherEffectiveSellPrice / currentEffectiveBuyPrice < 1.01) continue; // target a profit of at least 1%
                                // sometimes we may want to keep the profit as referenceCurrency instead of baseCurrency
                                const amountBuying = this.keepProfitAsReferenceCurrency() ? effectiveMinOrderSize : effectiveMinOrderSize * (otherBaseCurrencyPriceInfo.sellPrice / currentBaseCurrencyPriceInfo.buyPrice);

                                const numTimesRepeatable = Math.floor(Math.min(currentBaseCurrencyPriceInfo.buyDepth, otherBaseCurrencyPriceInfo.sellDepth) / effectiveMinOrderSize);
                                if (numTimesRepeatable < 1) continue;

                                if (this._paperTradingEnabled) {
                                    const tradeInfo = this.sameCurrencyPaperTradeFromInfo(
                                        currentConnector._name,
                                        otherConnector._name,
                                        currentBaseCurrencyPriceInfo.baseCurrency,
                                        currentBaseCurrencyPriceInfo.referenceCurrency,
                                        currentBaseCurrencyPriceInfo.buyPrice,
                                        amountBuying,
                                        otherBaseCurrencyPriceInfo.sellPrice,
                                        effectiveMinOrderSize
                                    );

                                    const recentTradeInfo = this.isRecentTrade(tradeInfo);
                                    if (recentTradeInfo.repeat) return;

                                    if (recentTradeInfo.repeatNumber === 1) this.addToRecentPaperTrades(tradeInfo, numTimesRepeatable);

                                    this._paperTradingMongoCollection.insertOne({
                                        mongo_timestamp: new Date(),
                                        trade_metadata: {
                                            strategy: "ClassicArbitrage",
                                            cross_currency: false,
                                            repeat_number: recentTradeInfo.repeatNumber
                                        },
                                        tradeInfo: tradeInfo
                                    });

                                    Logger.success("ClassicArbitrage", "tradeCompletion", "Found profitable paper trades and saved them to the database", this._socketBroadcaster);
                                    return;
                                }

                                if ((await this.currencyBalance(currentConnector, currentBaseCurrencyPriceInfo.referenceCurrency)) < amountBuying) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", "A favorable trade was found, but the exchange didn't have enough balance to buy required reference currency");
                                    return;
                                }

                                if ((await this.currencyBalance(otherConnector, otherBaseCurrencyPriceInfo.baseCurrency)) < effectiveMinOrderSize) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", `A favorable trade was found, but the exchange didn't have enough balance to sell required number of ${this._baseCurrency}`);
                                    return;
                                }

                                if (!(await Promise.all([
                                    currentConnector.addBuyOrder(amountBuying, currentBaseCurrencyPriceInfo.buyPrice, currentBaseCurrencyPriceInfo.referenceCurrency, currentBaseCurrencyPriceInfo.baseCurrency),
                                    otherConnector.addSellOrder(effectiveMinOrderSize, otherBaseCurrencyPriceInfo.sellPrice, otherBaseCurrencyPriceInfo.referenceCurrency, otherBaseCurrencyPriceInfo.baseCurrency)
                                ])).every(a => a)) {
                                    Logger.error("ClassicArbitrage", "submitBuyOrder", "One or more buy order submissions failed");
                                    return;
                                }

                                Logger.info("ClassicArbitrage", "tradeCompletion", "All orders placed and profitable trade completed successfully!", this._socketBroadcaster);
                            } else if (currentEffectiveSellPrice > otherEffectiveBuyPrice) {
                                if (currentEffectiveSellPrice / otherEffectiveBuyPrice < 1.01) continue; // target a profit of at least 1%

                                const amountBuying = this.keepProfitAsReferenceCurrency() ? effectiveMinOrderSize : effectiveMinOrderSize * (currentBaseCurrencyPriceInfo.sellPrice / otherBaseCurrencyPriceInfo.buyPrice);

                                const numTimesRepeatable = Math.floor(Math.min(otherBaseCurrencyPriceInfo.buyDepth, currentBaseCurrencyPriceInfo.sellDepth) / effectiveMinOrderSize);
                                if (numTimesRepeatable < 1) continue;

                                if (this._paperTradingEnabled) {
                                    const tradeInfo = this.sameCurrencyPaperTradeFromInfo(
                                        otherConnector._name,
                                        currentConnector._name,
                                        currentBaseCurrencyPriceInfo.baseCurrency,
                                        currentBaseCurrencyPriceInfo.referenceCurrency,
                                        otherBaseCurrencyPriceInfo.buyPrice,
                                        amountBuying,
                                        currentBaseCurrencyPriceInfo.sellPrice,
                                        effectiveMinOrderSize
                                    );

                                    const recentTradeInfo = this.isRecentTrade(tradeInfo);
                                    if (recentTradeInfo.repeat) return;

                                    if (recentTradeInfo.repeatNumber === 1) this.addToRecentPaperTrades(tradeInfo, numTimesRepeatable);

                                    this._paperTradingMongoCollection.insertOne({
                                        mongo_timestamp: new Date(),
                                        trade_metadata: {
                                            strategy: "ClassicArbitrage",
                                            cross_currency: false,
                                            repeat_number: recentTradeInfo.repeatNumber
                                        },
                                        tradeInfo: tradeInfo
                                    });

                                    Logger.success("ClassicArbitrage", "tradeCompletion", "Found profitable paper trades and saved them to the database", this._socketBroadcaster);
                                    return;
                                }

                                if ((await this.currencyBalance(otherConnector, otherBaseCurrencyPriceInfo.referenceCurrency)) < amountBuying) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", "A favorable trade was found, but the exchange didn't have enough balance to buy required reference currency");
                                    return;
                                }

                                if ((await this.currencyBalance(currentConnector, currentBaseCurrencyPriceInfo.baseCurrency)) < effectiveMinOrderSize) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", `A favorable trade was found, but the exchange didn't have enough balance to sell required number of ${this._baseCurrency}`);
                                    return;
                                }

                                if (!(await Promise.all([
                                    otherConnector.addBuyOrder(amountBuying, otherBaseCurrencyPriceInfo.buyPrice, otherBaseCurrencyPriceInfo.referenceCurrency, otherBaseCurrencyPriceInfo.baseCurrency),
                                    currentConnector.addSellOrder(effectiveMinOrderSize, currentBaseCurrencyPriceInfo.sellPrice, currentBaseCurrencyPriceInfo.referenceCurrency, currentBaseCurrencyPriceInfo.baseCurrency)
                                ])).every(a => a)) {
                                    Logger.error("ClassicArbitrage", "submitBuyOrder", "One or more buy order submissions failed");
                                    return;
                                }

                                Logger.info("ClassicArbitrage", "tradeCompletion", "All orders placed and profitable trade completed successfully!", this._socketBroadcaster);
                            }
                        } else {
                            // TODO: finish cross-currency
                            /**
                             * 
                             * @param {BaseProvider} currentConnector 
                             * @param {BaseProvider} otherConnector 
                             */
                            const processCrossCurrency = async (currentConnector, otherConnector) => {
                                const potentialMarket = this._marketCaches[currentConnector].filter(x => x.baseCurrency === currentBaseCurrencyPriceInfo.baseCurrency && x.referenceCurrency === currentBaseCurrencyPriceInfo.referenceCurrency);
                                if (potentialMarket.length === 0) return;
                                console.assert(potentialMarket.length === 1, `Cross currency exchange market possibilities are not unique (${potentialMarket.length} > 1)`);

                                const crossExchangeMarket = potentialMarket[0];
                                const crossExchangePriceInfo = await currentConnector.getMarketPrice(crossExchangeMarket.referenceCurrency, crossExchangeMarket.baseCurrency);

                                const potentialRtmMarketCurrentConnector = this._marketCaches[currentConnector._name].filter(x => x.baseCurrency === otherBaseCurrencyPriceInfo.baseCurrency && x.referenceCurrency === otherBaseCurrencyPriceInfo.referenceCurrency);
                                if (potentialRtmMarketCurrentConnector.length === 0) {
                                    console.log(`${JSON.stringify(otherBaseCurrencyPriceInfo.baseCurrency + "-" + otherBaseCurrencyPriceInfo.referenceCurrency)} not a valid pair on ${currentConnector._name}`);
                                    return;
                                }

                                console.assert(potentialRtmMarketCurrentConnector.length === 1, "Found more than one related markets for cross currency");
                                const baseCurrencyMarketCurrenctConnector = potentialRtmMarketCurrentConnector[0];
                                const baseCurrencyMarketCurrentConnectorPriceInfo = await currentConnector.getMarketPrice(baseCurrencyMarketCurrenctConnector.referenceCurrency, baseCurrencyMarketCurrenctConnector.baseCurrency);

                                const samePairCurrentPriceInfo = await currentConnector.getMarketPrice(otherBaseCurrencyPriceInfo.referenceCurrency, otherBaseCurrencyPriceInfo.baseCurrency);
                                console.assert(samePairCurrentPriceInfo.success, "Failed to get same pair current price info in cross currency");
                                
                                const minimumCrossExchangeTradeSize = currentConnector._minTradeVolumes[currentConnector.coinsToExchangePair([crossExchangeMarket.baseCurrency, crossExchangeMarket.referenceCurrency])];
                                console.assert(minimumCrossExchangeTradeSize >= 0, `Failed to get minimum trade size for ${currentConnector._name} | ${currentConnector.coinsToExchangePair([crossExchangeMarket.baseCurrency, crossExchangeMarket.referenceCurrency])}`);

                                const minimumCrossExchangeTradeSizeIntermediary = currentConnector.minTradeVolumeIsReferenceCurrency() ? minimumCrossExchangeTradeSize / crossExchangePriceInfo.buyPrice : minimumCrossExchangeTradeSize;
                                const minimumCrossExchangeTradeSizeBaseCurrency = minimumCrossExchangeTradeSizeIntermediary / baseCurrencyMarketCurrentConnectorPriceInfo.buyPrice;

                                
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
        Logger.info("ClassicArbitrage", "shutdown", "Trading algorithm stopped", this._socketBroadcaster);
    }
}