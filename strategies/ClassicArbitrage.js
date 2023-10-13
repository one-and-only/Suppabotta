import BaseStrategy from "./BaseStrategy.js";
import Logger from "../Logger.js";
import BaseProvider from "../providers/BaseProvider.js";

export default class ClassicArbitrageStrategy extends BaseStrategy {
    _marketCaches;
    _alreadyProcessed;
    _profitCurrencyPreferences;
    _disableCrossCurrency;

    /**
     * @param {BaseProvider[]} connectors 
     * @param {any} args 
     */
    constructor(connectors, args) {
        super(connectors, args);
        this._marketCaches = {};
        this._alreadyProcessed = [];
        this._profitCurrencyPreferences = [];
        this._disableCrossCurrency = false;

        if (args.disableCrossCurrency) this._disableCrossCurrency = args.disableCrossCurrency;

        if (args.profitCurrencyPreferences) {
            for (const [connector, choice] of Object.entries(args.profitCurrencyPreferences)) {
                this._profitCurrencyPreferences[connector] = choice;
            }
        } else {
            for (const connector of this._connectors) {
                this._profitCurrencyPreferences[connector._name] = true;
            }
        }
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
     * Checks if the combination of connectors and trading pairs has been processed
     * Aids in removing redundant price scans
     * @param {{ connector: string, tradingPair: { referenceCurrency: string, baseCurrency: string } }} connector1AndPair
     * @param {{ connector: string, tradingPair: { referenceCurrency: string, baseCurrency: string } }} connector2AndPair
     */
    comboAlreadyProcessed(connector1AndPair, connector2AndPair) {
        for (const combo of this._alreadyProcessed) {
            const match1 = (
                combo[connector1AndPair.connector] &&
                combo[connector1AndPair.connector].referenceCurrency === connector1AndPair.tradingPair.referenceCurrency &&
                combo[connector1AndPair.connector].baseCurrency === connector1AndPair.tradingPair.baseCurrency &&
                combo[connector2AndPair.connector] &&
                combo[connector2AndPair.connector].referenceCurrency === connector2AndPair.tradingPair.referenceCurrency &&
                combo[connector2AndPair.connector].baseCurrency === connector2AndPair.tradingPair.baseCurrency
            );

            const match2 = (
                combo[connector2AndPair.connector] &&
                combo[connector2AndPair.connector].referenceCurrency === connector1AndPair.tradingPair.referenceCurrency &&
                combo[connector2AndPair.connector].baseCurrency === connector1AndPair.tradingPair.baseCurrency &&
                combo[connector1AndPair.connector] &&
                combo[connector1AndPair.connector].referenceCurrency === connector2AndPair.tradingPair.referenceCurrency &&
                combo[connector1AndPair.connector].baseCurrency === connector2AndPair.tradingPair.baseCurrency
            );

            if (match1 || match2) return true;
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
     * @param {BaseProvider} connector Connector used to query price info for RTM markets
     */
    async rtmMarketPriceInfoForConnector(connector) {
        return await Promise.all(await this.connectorMarkets(connector._name).filter(x => x.baseCurrency === "RTM").map(async x => {
            return {
                baseCurrency: x.baseCurrency,
                referenceCurrency: x.referenceCurrency,
                ...(await connector.getMarketPrice(x.referenceCurrency, x.baseCurrency))
            };
        }))
    }

    connectorMarkets(connectorName) {
        return this._marketCaches[connectorName];
    }

    /**
     * Check the balance of a currency in a specified exchange
     * @param {BaseProvider} connector Connector for the exchange we're checking the balance of
     * @param {string} currency Currency to query the balance for
     */
    async currencyBalance(connector, currency) {
        return await connector.getBalance(currency.toUpperCase());
    }

    async start() {
        Logger.info("ClassicArbitrage", "startup", "Caching connector info required for trading...", this._socketBroadcaster);
        for (const connector of this._connectors) {
            this._marketCaches[connector._name] = await connector.getAllMarkets();
        }

        Logger.info("ClassicArbitrage", "startup", "Startup complete and trading started!", this._socketBroadcaster);
    }

    async tick() {
        for (const connector of this._connectors) {
            // we need to wait until the pending trades are complete before executing another one
            if (connector._pendingTrades.length > 0) {
                for (let i = 0; i < connector._pendingTrades.length; i++) {
                    const orderId = connector._pendingTrades[i];
                    // still have some pending trades, so we can't continue this tick
                    if ((await connector.orderStatus(orderId)).quantityLeft > 0) return;

                    connector._pendingTrades.splice(i, 1); // trade complete
                }
            }
        }
        for (const currentConnector of this._connectors) {
            const currentRtmPriceInfos = await this.rtmMarketPriceInfoForConnector(currentConnector);

            for (const currentRtmPriceInfo of currentRtmPriceInfos) {
                for (const otherConnector of this._connectors) {
                    if (currentConnector._name === otherConnector._name) continue;

                    const otherRtmPriceInfos = await this.rtmMarketPriceInfoForConnector(otherConnector);

                    for (const otherRtmPriceInfo of otherRtmPriceInfos) {
                        if (this.comboAlreadyProcessed({ connector: currentConnector._name, tradingPair: currentRtmPriceInfo }, { connector: otherConnector._name, tradingPair: otherRtmPriceInfo })) continue;
                        this.markAsProcessed([currentConnector._name, otherConnector._name], currentRtmPriceInfo, otherRtmPriceInfo);

                        if (otherRtmPriceInfo.referenceCurrency === currentRtmPriceInfo.referenceCurrency) {
                            const currentEffectiveBuyPrice = currentRtmPriceInfo.buyPrice * (1 + currentConnector._takerFeePct / 100); // spending more than the value of the coin with fees
                            const currentEffectiveSellPrice = currentRtmPriceInfo.sellPrice / (1 + currentConnector._takerFeePct / 100); // getting less money than the value of the coin with fees
                            const otherEffectiveBuyPrice = otherRtmPriceInfo.buyPrice * (1 + otherConnector._takerFeePct / 100);
                            const otherEffectiveSellPrice = otherRtmPriceInfo.sellPrice / (1 + otherConnector._takerFeePct / 100);

                            const currentMinOrderSize = currentConnector.minOrderSize(currentRtmPriceInfo.referenceCurrency);
                            const otherMinOrderSize = otherConnector.minOrderSize(otherRtmPriceInfo.referenceCurrency);

                            const currentMinOrderSizeRtm = currentConnector.minTradeVolumeIsReferenceCurrency() ? currentMinOrderSize / currentRtmPriceInfo.buyPrice : currentMinOrderSize;
                            const otherMinOrderSizeRtm = otherConnector.minTradeVolumeIsReferenceCurrency() ? otherMinOrderSize / otherRtmPriceInfo.buyPrice : otherMinOrderSize;

                            const currentMinOrderSizeGreater = currentMinOrderSizeRtm > otherMinOrderSizeRtm;
                            let effectiveMinOrderSizeRtm = currentMinOrderSizeGreater ? currentMinOrderSizeRtm : otherMinOrderSizeRtm;

                            // TODO: merge the order creation into one function to avoid repetition

                            // NOTE: in the `if` and the `else if` referenceCurrency is always going to be the same on both otherConnector and currentConnector
                            // NOTE: baseCurrency in the `if` and `else if` is always going to be RTM, as this trading bot is currently only for RTM
                            if (currentEffectiveBuyPrice < otherEffectiveSellPrice) {
                                const rtmProfitFactor = otherRtmPriceInfo.sellPrice / currentRtmPriceInfo.buyPrice;
                                const amountRtmSelling = this.keepProfitAsReferenceCurrency() ? effectiveMinOrderSizeRtm : Math.ceil(effectiveMinOrderSizeRtm / rtmProfitFactor); // sometimes we may want to keep the profit as RTM instead of referenceCurrency (Ex: USDT)

                                // if we're keeping profit as RTM on the otherConnector's exchange,
                                // we need to make sure that the smallest amount of RTM we sell on the other end is greater than its min order size
                                if (!this.keepProfitAsReferenceCurrency(otherConnector._name) && (otherMinOrderSizeRtm < (effectiveMinOrderSizeRtm / rtmProfitFactor))) {
                                    effectiveMinOrderSizeRtm = Math.ceil(effectiveMinOrderSizeRtm * rtmProfitFactor); // since we always specify buy/sell amounts as RTM, $ value isn't affected much by rounding
                                }

                                if ((await this.currencyBalance(currentConnector, currentRtmPriceInfo.referenceCurrency)) < effectiveMinOrderSizeRtm) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", "A favorable trade was found, but the exchange didn't have enough balance to buy required reference currency");
                                    return;
                                }

                                if ((await this.currencyBalance(otherConnector, otherRtmPriceInfo.baseCurrency)) < amountRtmSelling) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", "A favorable trade was found, but the exchange didn't have enough balance to sell required number of RTM");
                                    return;
                                }

                                if (!(await Promise.all([
                                    currentConnector.addBuyOrder(effectiveMinOrderSizeRtm, currentRtmPriceInfo.buyPrice, currentRtmPriceInfo.referenceCurrency, currentRtmPriceInfo.baseCurrency),
                                    otherConnector.addSellOrder(amountRtmSelling, otherRtmPriceInfo.sellPrice, otherRtmPriceInfo.referenceCurrency, otherRtmPriceInfo.baseCurrency)
                                ])).every(a => a)) {
                                    Logger.error("ClassicArbitrage", "submitBuyOrder", "One or more buy order submissions failed");
                                    return;
                                }

                                Logger.info("ClassicArbitrage", "tradeCompletion", "All orders placed and profitable trade completed successfully!", this._socketBroadcaster);
                            } else if (currentEffectiveSellPrice > otherEffectiveBuyPrice) {
                                const rtmProfitFactor = currentRtmPriceInfo.sellPrice / otherRtmPriceInfo.buyPrice;
                                const amountRtmSelling = this.keepProfitAsReferenceCurrency() ? effectiveMinOrderSizeRtm : Math.ceil(effectiveMinOrderSizeRtm / rtmProfitFactor);

                                if (!this.keepProfitAsReferenceCurrency(currentConnector._name) && currentMinOrderSizeRtm < (effectiveMinOrderSizeRtm / rtmProfitFactor)) {
                                    effectiveMinOrderSizeRtm = Math.ceil(effectiveMinOrderSizeRtm * rtmProfitFactor);
                                }

                                if ((await this.currencyBalance(otherConnector, otherRtmPriceInfo.referenceCurrency)) < effectiveMinOrderSizeRtm) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", "A favorable trade was found, but the exchange didn't have enough balance to buy required reference currency");
                                    return;
                                }

                                if ((await this.currencyBalance(currentConnector, currentRtmPriceInfo.baseCurrency)) < amountRtmSelling) {
                                    Logger.warning("ClassicArbitrage", "balanceCheck", "A favorable trade was found, but the exchange didn't have enough balance to sell required number of RTM");
                                    return;
                                }

                                if (!(await Promise.all([
                                    otherConnector.addBuyOrder(effectiveMinOrderSizeRtm, otherRtmPriceInfo.buyPrice, otherRtmPriceInfo.referenceCurrency, otherRtmPriceInfo.baseCurrency),
                                    currentConnector.addSellOrder(amountRtmSelling, currentRtmPriceInfo.sellPrice, currentRtmPriceInfo.referenceCurrency, currentRtmPriceInfo.baseCurrency)
                                ])).every(a => a)) {
                                    Logger.error("ClassicArbitrage", "submitBuyOrder", "One or more buy order submissions failed");
                                    return;
                                }

                                Logger.info("ClassicArbitrage", "tradeCompletion", "All orders placed and profitable trade completed successfully!", this._socketBroadcaster);
                            }
                        } else {
                            if (this._disableCrossCurrency) continue;
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