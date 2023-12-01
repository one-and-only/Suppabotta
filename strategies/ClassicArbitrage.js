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
    constructor(connectors, args) {
        super(connectors, args);
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

    async start() {
        Logger.info("ClassicArbitrage", "startup", "Caching connector info required for trading...", this._socketBroadcaster);
        await this.populateMarketCaches();
        Logger.info("ClassicArbitrage", "startup", "Startup complete and trading started!", this._socketBroadcaster);
    }

    async tick() {
        //? might not be needed
        // for (const connector of this._connectors) {
        //     // we need to wait until the pending trades are complete before executing another one
        //     if (connector._pendingTrades.length > 0) {
        //         for (let i = 0; i < connector._pendingTrades.length; i++) {
        //             const orderId = connector._pendingTrades[i];
        //             // still have some pending trades, so we can't continue this tick
        //             if ((await connector.orderStatus(orderId)).quantityLeft > 0) return;

        //             connector._pendingTrades.splice(i, 1); // trade complete
        //         }
        //     }
        // }
        for (const currentConnector of this._connectors) {
            const currentRtmPriceInfos = await this.baseCurrencyMarketPriceInfoForConnector(currentConnector);

            for (const currentRtmPriceInfo of currentRtmPriceInfos) {
                for (const otherConnector of this._connectors) {
                    if (currentConnector._name === otherConnector._name) continue;

                    const otherRtmPriceInfos = await this.baseCurrencyMarketPriceInfoForConnector(otherConnector);

                    for (const otherRtmPriceInfo of otherRtmPriceInfos) {
                        if (this.comboAlreadyProcessed({ connector: currentConnector._name, tradingPair: currentRtmPriceInfo }, { connector: otherConnector._name, tradingPair: otherRtmPriceInfo })) continue;
                        this.markAsProcessed([currentConnector._name, otherConnector._name], currentRtmPriceInfo, otherRtmPriceInfo);

                        if (otherRtmPriceInfo.referenceCurrency === currentRtmPriceInfo.referenceCurrency) {
                            continue; //! re-enable once cross-currency stuff is done
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

                            /**
                             * Exchange a starting currency into an ending currency, using the provided exchange path information.
                             * This just gets us the right currency in the exchange we are shuffling around coins and not the full trade process.
                             * We would still need to buy on one exchange and sell on the other
                             * @param {BaseProvider} pathConnector 
                             * @param {{baseCurrency:string,depth:number,price:number,referenceCurrency:string,referenceCurrencyInverted:boolean,minimumCoinsRequired:number|undefined}[]} pathInfo 
                             */
                            const fulfillCrossCurrencyExchangePath = async (pathConnector, pathInfo) => {
                                const takerFeeFactor = 1 + pathConnector._takerFeePct / 100;

                                // we first need to calculate how many coins we need for each step
                                const amountRequired = [];
                                let _internalIntermediateMinimum;
                                for (let i = pathInfo.length - 1; i > 0; i--) {
                                    if (i === pathInfo.length - 1) _internalIntermediateMinimum = pathInfo[i].minimumCoinsRequired;
                                    else _internalIntermediateMinimum = (_internalIntermediateMinimum / pathInfo[i].price) * takerFeeFactor;

                                    amountRequired.push(_internalIntermediateMinimum);
                                }

                                // depth and balance has already been checked before calling this function
                                for (let i = 0; i < pathInfo.length; i++) {
                                    const { price, referenceCurrencyInverted } = pathInfo[i];
                                    let { referenceCurrency, baseCurrency } = pathInfo[i];
                                    const endingCurrency = referenceCurrency;

                                    if (referenceCurrencyInverted) {
                                        referenceCurrency = baseCurrency;
                                        baseCurrency = endingCurrency;

                                        // we buy when the currencies are inverted (normally we sell our way to the ending currency)
                                        // we have already inverted referenceCurrency and baseCurrency a few lines ago, so this is fine
                                        //                                                                ∨                ∨
                                        //! this and the other order will be re-enabled once debugging is over
                                        // await pathConnector.addBuyOrder(amountRequired[i], price, referenceCurrency, baseCurrency);
                                    } else {
                                        // await pathConnector.addSellOrder(amountRequired[i], price, referenceCurrency, baseCurrency);
                                    }
                                }

                                Logger.success("ClassicArbitrage", "submitOrders", "Orders submitted successfully!", this._socketBroadcaster);
                            }

                            /**
                             * Check and, if applicable, fulfill a profitable cross-currency trade
                             * @param {BaseProvider} pathConnector 
                             * @param {string} pathReferenceCurrency 
                             * @param {BaseProvider} otherConnector 
                             * @param {{ referenceCurrency: string, baseCurrency: string, sellPrice: number, sellDepth: number, buyPrice: number, buyDepth: number }} otherConnectorPriceInfo 
                             * @param {boolean} otherConnectorBuying 
                             * @returns 
                             */
                            const processCrossCurrency = async (pathConnector, pathReferenceCurrency, otherConnector, otherConnectorPriceInfo, otherConnectorBuying) => {
                                const shortestPath = this.shortestCrossCurrencyPath(pathConnector, pathReferenceCurrency, otherConnectorPriceInfo.referenceCurrency);
                                if (!shortestPath) return;

                                const effectivePrice = await this.effectiveReferencePrice(otherConnector, shortestPath, !otherConnectorBuying);

                                /**
                                 * Ensure that the user has enough balance and the exchange has enough depth for each trading step
                                 * @param {BaseProvider} pathConnector Connector that the path data is tied to
                                 * @param {{baseCurrency:string,depth:number,price:number,referenceCurrency:string,referenceCurrencyInverted:boolean,minimumCoinsRequired:number|undefined}[]} pathInfo array of trading steps that need to be taken to convert one currency to another
                                 * @returns {Promise<boolean>} Whether the given path is fully actionable
                                 */
                                const tradeConditionsSatisfied = async (pathConnector, pathInfo) => {
                                    let minimumCoinsRequired;
                                    const takerFeeFactor = 1 + pathConnector._takerFeePct / 100;

                                    for (let i = pathInfo.length - 1; i > 0; i--) {
                                        const { depth, price, referenceCurrencyInverted } = pathInfo[i];
                                        let { referenceCurrency, baseCurrency } = pathInfo[i];
                                        const endingCurrency = referenceCurrency;

                                        // this data is something that is given inside of the last step of `pathInfo`
                                        if (i === (pathInfo.length - 1)) minimumCoinsRequired = pathInfo[i].minimumCoinsRequired;
                                        else minimumCoinsRequired = (minimumCoinsRequired / price) * takerFeeFactor;

                                        if (referenceCurrencyInverted) {
                                            referenceCurrency = baseCurrency;
                                            baseCurrency = endingCurrency;
                                        }

                                        // checking depth first to make sure that the exchange is good to go before undertaking the expensive operation of querying user balance
                                        if (
                                            (referenceCurrencyInverted && depth < minimumCoinsRequired) ||
                                            (!referenceCurrencyInverted && depth < minimumCoinsRequired)
                                        ) {
                                            Logger.warning("ClassicArbitrage", "multiCurrencyPathDepthCheck", "Favorable price was found, but the exchange doesn't have enough depth to execute all trades", this._socketBroadcaster);
                                            return false;
                                        }

                                        // the original baseCurrency is what we are targetting for a balance check
                                        // because that is the currency we are converting towards the ending currency
                                        const balance = (await pathConnector.getBalance(referenceCurrencyInverted ? referenceCurrency : baseCurrency));
                                        if (balance < minimumCoinsRequired) {
                                            Logger.warning("ClassicArbitrage", "multiCurrencyPathBalanceCheck", "Favorable price was found, but the user didn't have enough balance to execute all trades", this._socketBroadcaster);
                                            return false;
                                        }
                                    }

                                    return true;
                                }

                                if (otherConnectorBuying && effectivePrice.effectiveRtmPrice > otherConnectorPriceInfo.buyPrice) {
                                    if (!(await tradeConditionsSatisfied(pathConnector, effectivePrice.path))) return;

                                    await fulfillCrossCurrencyExchangePath(pathConnector, shortestPath);

                                    //! re-enable this and the other Promise.all once debugging is done
                                    // await Promise.all([
                                    //     await pathConnector.addSellOrder(minimumCoinsRequired, effectivePrice.finalPrice, otherConnectorPriceInfo.referenceCurrency, otherConnectorPriceInfo.baseCurrency),
                                    //     await otherConnector.addBuyOrder(minimumCoinsRequired, 0.000, otherConnectorPriceInfo.referenceCurrency, otherConnectorPriceInfo.baseCurrency)
                                    // ]);

                                    Logger.success("ClassicArbitrage", "orderSubmission", "yoooooo! you already know what it is :100: 1", this._socketBroadcaster);
                                } else if (!otherConnectorBuying && effectivePrice.effectiveRtmPrice < otherConnectorPriceInfo.sellPrice) {
                                    if (!(await tradeConditionsSatisfied(pathConnector, effectivePrice.path))) return;

                                    await fulfillCrossCurrencyExchangePath(pathConnector, shortestPath);

                                    // await Promise.all([
                                    //     await pathConnector.addBuyOrder(minimumCoinsRequired, effectivePrice.finalPrice, otherConnectorPriceInfo.referenceCurrency, otherConnectorPriceInfo.baseCurrency),
                                    //     await otherConnector.addSellOrder(minimumCoinsRequired, 0.000, otherConnectorPriceInfo.referenceCurrency, otherConnectorPriceInfo.baseCurrency)
                                    // ]);

                                    Logger.success("ClassicArbitrage", "orderSubmission", "yoooooo! you already know what it is :100: 2", this._socketBroadcaster);
                                }
                            }

                            //! turn into Promise.all after done with debugging
                            await processCrossCurrency(currentConnector, currentRtmPriceInfo.referenceCurrency, otherConnector, otherRtmPriceInfo, false);
                            await processCrossCurrency(otherConnector, otherRtmPriceInfo.referenceCurrency, currentConnector, currentRtmPriceInfo, true)
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