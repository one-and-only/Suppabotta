import BaseStrategy from "./BaseStrategy.js";
import Logger from "../Logger.js";

// TODO min amount does not always reference referenceCurrency

export default class ClassicArbitrageStrategy extends BaseStrategy {
    _alreadyProcessed;

    constructor(connectors) {
        super(connectors);
        this._alreadyProcessed = new Set();
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

    async start() { }

    async tick() {
        // we need to wait until the pending trades are complete before executing another one
        for (const connector of this._connectors) {
            if (connector._pendingTrades.length > 0) return;
        }

        for (const currentConnector of this._connectors) {
            for (const currentReferenceCurrency in currentConnector._tradingPairs) {
                const currentTradingPair = currentConnector.coinToExchangePair(currentReferenceCurrency);

                const currentMinOrderSize = currentConnector.minOrderSize(currentReferenceCurrency);
                const currentPriceInfo = await currentConnector.getMarketPrice(currentReferenceCurrency);

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

                    const otherMinOrderSize = otherConnector.minOrderSize(currentReferenceCurrency);
                    const commonMinOrderAmount = currentMinOrderSize > otherMinOrderSize ? currentMinOrderSize : otherMinOrderSize;

                    const otherPriceInfo = await otherConnector.getMarketPrice(currentReferenceCurrency);

                    // console.log(currentConnector._name, currentReferenceCurrency, currentPriceInfo.buyPrice, currentPriceInfo.sellPrice);
                    // console.log(otherConnector._name, currentReferenceCurrency, otherPriceInfo.buyPrice, otherPriceInfo.sellPrice);

                    if ((currentPriceInfo.sellPrice / otherPriceInfo.buyPrice) >= 1.015) {
                        console.log("Found a suitable ClassicArbitrage trade (opt0):");
                        const numRtmBuying = commonMinOrderAmount / otherPriceInfo.buyPrice;
                        const numRtmSelling = commonMinOrderAmount / currentPriceInfo.sellPrice;
                        const numRtmProfit = numRtmBuying - numRtmSelling;
                        console.log(`Buying ${numRtmBuying} RTM from ${otherConnector._name} @ ${otherPriceInfo.buyPrice} (${currentReferenceCurrency})`);
                        console.log(`Selling ${numRtmSelling} RTM on ${currentConnector._name} @ ${currentPriceInfo.sellPrice} (${currentReferenceCurrency}; Estimating ${numRtmProfit} RTM in profit)`);
                        const referenceBalance = await otherConnector.getBalance(currentReferenceCurrency);
                        const rtmBalance = await currentConnector.getBalance("RTM");

                        if (!referenceBalance.success || !rtmBalance.success) {
                            Logger.error("Failed to get balance");
                            return;
                        }

                        if (
                            referenceBalance.available < commonMinOrderAmount ||
                            rtmBalance.available < numRtmSelling
                        ) {
                            Logger.warning("Not enough balance to execute suitable ClassicArbitrage trade");
                            return;
                        }

                        await Promise.all([
                            otherConnector.addBuyOrder(numRtmBuying, otherPriceInfo.buyPrice, currentReferenceCurrency),
                            currentConnector.addSellOrder(numRtmSelling, currentPriceInfo.sellPrice, currentReferenceCurrency)
                        ]);
                        Logger.success("Executed ClassicArbitrade trade!");
                    } else if ((otherPriceInfo.sellPrice / currentPriceInfo.buyPrice) >= 1.015) {
                        console.log("Found a suitable ClassicArbitrage trade (opt1):");
                        const numRtmBuying = commonMinOrderAmount / currentPriceInfo.buyPrice;
                        const numRtmSelling = commonMinOrderAmount / otherPriceInfo.sellPrice;
                        const numRtmProfit = numRtmBuying - numRtmSelling;
                        console.log(`Buying ${numRtmBuying} RTM from ${currentConnector._name} @ ${currentPriceInfo.buyPrice} (${currentReferenceCurrency})`);
                        console.log(`Selling ${numRtmSelling} RTM on ${otherConnector._name} @ ${otherPriceInfo.sellPrice} (${currentReferenceCurrency}; Estimating ${numRtmProfit} RTM in profit)`);

                        const referenceBalance = await currentConnector.getBalance("currentReferenceCurrency");
                        const rtmBalance = await otherConnector.getBalance("RTM");

                        if (!referenceBalance.success || !rtmBalance.success) {
                            Logger.error("Failed to get balance");
                            return;
                        }

                        if (
                            referenceBalance.available < commonMinOrderAmount ||
                            rtmBalance.available < numRtmSelling
                        ) {
                            Logger.warning("Not enough balance to execute suitable ClassicArbitrage trade");
                            return;
                        }

                        await Promise.all([
                            currentConnector.addBuyOrder(numRtmBuying, currentPriceInfo.buyPrice, currentReferenceCurrency),
                            otherConnector.addSellOrder(numRtmSelling, otherPriceInfo.sellPrice, currentReferenceCurrency)
                        ]);
                    }
                }
            }
        }
        this._alreadyProcessed.clear();
    }

    /**
     * 
     * @param {string} coin 
     * @param {string} tradingPair 
     * @param {BaseProvider} connector 
     * @returns whether the user has enough coins to trade or not
     */
    async hasEnoughCoin(coin, tradingPair, connector) {

    }

    async shutdown() {
        // cancel all pending orders
    }
}