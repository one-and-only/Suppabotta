import BaseStrategy from "./BaseStrategy.js";
import Logger from "../Logger.js";
import BaseProvider from "../providers/BaseProvider.js";

export default class FloatingArbitrageStrategy extends BaseStrategy {
    _alreadyProcessed;
    _priceCache;
    _balanceCache;
    _maxInvPct;

    constructor(connectors, args) {
        super(connectors);
        this._alreadyProcessed = new Set();
        this._maxInvPct = (args.maxInvPct / 100) ?? 0;
    }

    initializeCaches() {
        this._priceCache = {};
        this._balanceCache = {};

        for (const connector of this._connectors) {
            this._priceCache[connector._name] = {};
            this._balanceCache[connector._name] = {};
        }
    }

    /**
     * Check whether the connector and exchange pair combo has already been processed
     * @param {string[]} connectorNames array of connector._name
     * @param {string[]} tradingPairs array of connector._tradingPairs[...].pair
     * @returns {boolean} whether the connector and exchange pair combo has already been processed
     */
    comboAlreadyProcessed(connectorNames, tradingPairs) {
        for (const el of this._alreadyProcessed) {
            if (connectorNames.every(x => el.connectorNames.includes(x)) && tradingPairs.every(x => el.tradingPairs.includes(x))) {
                return true;
            }
        }

        return false;
    }

    async start() {
        Logger.info("FloatingArbitrage", "startup", "Trading started!", this._socketBroadcaster);
    }

    /**
     * Get the market price of a trading pair from cache, adding to the cache if no entry exists
     * @param {BaseProvider} connector connector you're using to query the price
     * @param {string} referenceCurrency currency to which RTM is paired
     */
    async cachedMarketPrice(connector, referenceCurrency) {
        if (!this._priceCache[connector._name][referenceCurrency]) {
            this._priceCache[connector._name][referenceCurrency] = await connector.getMarketPrice(referenceCurrency);
        }

        return this._priceCache[connector._name][referenceCurrency];
    }

    /**
     * Get the balance of a currency from cache, adding to the cache if no entry exists
     * @param {BaseProvider} connector connector you're using to query a currency's balance
     * @param {string} currency currency you're getting the balance of
     */
    async cachedBalance(connector, currency) {
        if (!this._balanceCache[connector._name]?.[currency]) {
            this._balanceCache[connector._name][currency] = await connector.getBalance(currency);
        }

        return this._balanceCache[connector._name][currency];
    }

    /**
     * Process a potential arbitrage trade. Executes only if there is enough depth in the exchange and balance in the wallet.
     * @param {BaseProvider} connector1
     * @param {BaseProvider} connector2
     * @param {object} priceInfo1
     * @param {object} priceInfo2
     * @param {number} commonMinOrderAmount
     * @param {string} referenceCurrency
     */
    async processSuitablePrices(connector1, connector2, priceInfo1, priceInfo2, commonMinOrderAmount, referenceCurrency) {

        const referenceBalance = await this.cachedBalance(connector2, referenceCurrency);
        const rtmBalance = await this.cachedBalance(connector1, "RTM");
        if (!referenceBalance.success || !rtmBalance.success) {
            Logger.error("FloatingArbitrage", "submitOrder_balanceCheck", "Failed to get balance", this._socketBroadcaster);
            return;
        }

        const maxReferenceBalance = referenceBalance.available * this._maxInvPct;
        const maxRtmBalance = rtmBalance.available * this._maxInvPct;
        const commonBalance = maxReferenceBalance < (maxRtmBalance * priceInfo2.buyPrice) ? maxReferenceBalance : maxRtmBalance * priceInfo2.buyPrice;
        if (
            commonBalance < commonMinOrderAmount
        ) {
            Logger.warning("FloatingArbitrage", "submitOrder_balanceCheck", "Not enough balance to execute suitable FloatingArbitrage trade, giving up.", this._socketBroadcaster);
            return;
        }

        const rtmAmount = commonBalance / priceInfo2.buyPrice;
        Logger.info("FloatingArbitrage", "submitOrder_execute", `Buying ${rtmAmount} RTM from ${connector2._name} @ ${priceInfo2.buyPrice} (${referenceCurrency})`, this._socketBroadcaster);
        Logger.info("FloatingArbitrage", "submitOrder_execute", `Selling ${rtmAmount} RTM on ${connector1._name} @ ${priceInfo1.sellPrice} (${referenceCurrency}; Estimating ${(rtmAmount * priceInfo1.sellPrice) - commonBalance} ${referenceCurrency} in profit once fully executed)`, this._socketBroadcaster);

        await Promise.all([
            connector2.addBuyOrder(rtmAmount, priceInfo2.buyPrice, referenceCurrency),
            connector1.addSellOrder(rtmAmount, priceInfo1.sellPrice, referenceCurrency)
        ]);
        Logger.success("FloatingArbitrage", "submitOrder", "Executed FloatingArbitrage trade!", this._socketBroadcaster);
    }

    async tick() {
        this.initializeCaches();

        // we need to wait until the pending trades are complete before executing another one
        for (const connector of this._connectors) {
            if (connector._pendingTrades.length > 0) {
                for (let i = 0; i < connector._pendingTrades.length; i++) {
                    const orderId = connector._pendingTrades[i];
                    // still have some pending trades, so we can't continue this tick
                    if ((await connector.orderStatus(orderId)).quantityLeft > 0) return;

                    connector._pendingTrades.splice(i, 1); // trade complete
                }
            }

            for (const currentConnector of this._connectors) {
                for (const currentReferenceCurrency in currentConnector._tradingPairs) {
                    const currentTradingPair = currentConnector.coinToExchangePair(currentReferenceCurrency);

                    let currentMinOrderSize = currentConnector.minOrderSize(currentReferenceCurrency);
                    const currentPriceInfo = await this.cachedMarketPrice(currentConnector, currentReferenceCurrency);

                    for (const otherConnector of this._connectors) {
                        // we don't want to process the current connector
                        if (otherConnector._name === currentConnector._name) continue;

                        // not all exchanges have the same RTM trading pairs
                        if (!otherConnector.referenceCurrencyExists(currentReferenceCurrency)) continue;

                        const otherTradingPair = otherConnector.coinToExchangePair(currentReferenceCurrency);
                        if (this.comboAlreadyProcessed([currentConnector._name, otherConnector._name], [currentTradingPair, otherTradingPair])) continue;
                        else this._alreadyProcessed.add({
                            connectorNames: [currentConnector._name, otherConnector._name],
                            tradingPairs: [currentTradingPair, otherTradingPair]
                        });

                        let otherMinOrderSize = otherConnector.minOrderSize(currentReferenceCurrency);

                        const otherPriceInfo = await this.cachedMarketPrice(otherConnector, currentReferenceCurrency);

                        if ((currentPriceInfo.sellPrice / otherPriceInfo.buyPrice) >= 1.015) {
                            currentMinOrderSize = currentConnector.minTradeVolumeIsReferenceCurrency() ? currentMinOrderSize : currentMinOrderSize * currentPriceInfo.sellPrice;
                            otherMinOrderSize = otherConnector.minTradeVolumeIsReferenceCurrency() ? otherMinOrderSize : otherMinOrderSize * otherPriceInfo.buyPrice;
                            const commonMinOrderAmount = currentMinOrderSize > otherMinOrderSize ? currentMinOrderSize : otherMinOrderSize;
                            await this.processSuitablePrices(currentConnector, otherConnector, currentPriceInfo, otherPriceInfo, commonMinOrderAmount, currentReferenceCurrency);
                        } else if ((otherPriceInfo.sellPrice / currentPriceInfo.buyPrice) >= 1.015) {
                            currentMinOrderSize = currentConnector.minTradeVolumeIsReferenceCurrency() ? currentMinOrderSize : currentMinOrderSize * currentPriceInfo.buyPrice;
                            otherMinOrderSize = otherConnector.minTradeVolumeIsReferenceCurrency() ? otherMinOrderSize : otherMinOrderSize * otherPriceInfo.sellPrice;
                            const commonMinOrderAmount = currentMinOrderSize > otherMinOrderSize ? currentMinOrderSize : otherMinOrderSize;
                            await this.processSuitablePrices(otherConnector, currentConnector, otherPriceInfo, currentPriceInfo, commonMinOrderAmount, currentReferenceCurrency);
                        }
                    }
                }
            }
        }
        this._alreadyProcessed.clear();
    }

    async shutdown() {
        for (const connector of this._connectors) {
            await connector.cancelAllPending();
        }
    }
}