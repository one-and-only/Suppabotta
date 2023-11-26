import BaseStrategy from './BaseStrategy.js';
import BaseProvider from '../providers/BaseProvider.js';
import Logger from '../Logger.js';

export default class TickerMaintenanceStrategy extends BaseStrategy {
    _lastMaintainedTimestamp;
    _lastBalanceCheckTimestamp;
    _baseCurrency;

    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args) {
        super(connectors, args);

        if (!args.baseCurrency) {
            Logger.error("TickerMaintenance", "startup", "baseCurrency is not defined. Please add it as an algorithm parameter", this._socketBroadcaster);
        }

        this._lastMaintainedTimestamp = 0;
        this._lastBalanceCheckTimestamp = 0;
        this._buyingReferenceCurrency = false;
        this._baseCurrency = args.baseCurrency;
    }

    async balanceCheck() {
        this._lastBalanceCheckTimestamp = Date.now();
        for (const connector of this._connectors) {
            const baseCurrencyBalance = await connector.getBalance(this._baseCurrency);

            for (const tradingPairIdx in connector._tradingPairs) {
                const referenceCurrency = connector.exchangePairToCoin(connector._tradingPairs[tradingPairIdx]);

                if (!baseCurrencyBalance.success) {
                    connector._tradingPairs[referenceCurrency].enabled = false;
                    continue;
                }

                const priceInfo = await connector.getMarketPrice(referenceCurrency);
                const referenceBalance = await connector.getBalance(referenceCurrency);
                const minOrderSize = connector.minOrderSize(referenceCurrency);
                const commonMinOrderAmount = connector.minTradeVolumeIsReferenceCurrency() ? minOrderSize : minOrderSize * priceInfo.buyPrice;

                if (referenceBalance.available < commonMinOrderAmount || (baseCurrencyBalance.available * priceInfo.sellPrice) < commonMinOrderAmount) {
                    Logger.warning("TickerMaintenance", `balanceCheck_${connector._name}`, `Not enough balance on ${connector._name} RTM/${referenceCurrency}`, this._socketBroadcaster);
                    connector._tradingPairs[referenceCurrency].enabled = false;
                    continue;
                }

                connector._tradingPairs[referenceCurrency].enabled = true;
            }
        }
    }

    async start() {
        await this.balanceCheck();
    }

    async tick() {
        const currentTimestamp = Date.now();

        // balance check every 60 seconds
        if (currentTimestamp - this._lastBalanceCheckTimestamp > 60000) {
            await this.balanceCheck();
        }

        // ticker maintenance every 5 minutes
        if (currentTimestamp - this._lastMaintainedTimestamp > (process.env.TICKER_MAINTENANCE_INTERVAL ? parseInt(process.env.TICKER_MAINTENANCE_INTERVAL) : 300000)) {
            this._lastMaintainedTimestamp = currentTimestamp;

            for (const connector of this._connectors) {
                for (const referenceCurrency in connector._tradingPairs) {
                    const minTradeVolume = connector.minOrderSize(referenceCurrency);

                    const market = await connector.getMarketPrice(referenceCurrency);
                    const settledPrice = this.decimalRounding((market.buy - market.sell) / 2, 11);

                    const amountRtm = minTradeVolume / settledPrice;
                    await Promise.all([
                        connector.addBuyOrder(amountRtm, settledPrice, referenceCurrency, this._baseCurrency),
                        connector.addSellOrder(amountRtm, settledPrice, referenceCurrency, this._baseCurrency)
                    ]);
                }
            }
        }
    }

    async shutdown() {
        for (const connector of this._connectors) {
            await connector.cancelAllPending();
        }
        return;
    }
}