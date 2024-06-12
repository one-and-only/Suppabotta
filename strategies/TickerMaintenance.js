import BaseStrategy from './BaseStrategy.js';
import BaseProvider from '../providers/BaseProvider.js';
import Logger from '../Logger.js';

export default class TickerMaintenanceStrategy extends BaseStrategy {
    _lastMaintainedTimestamp;
    _baseCurrency;
    _maintenanceInterval;
    _markets;

    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args) {
        super(connectors, args);

        if (!args.baseCurrency) {
            Logger.error("TickerMaintenance", "startup", "baseCurrency is not defined. Please add it as an algorithm parameter", true);
        }

        this._lastMaintainedTimestamp = 0;
        this._baseCurrency = args.baseCurrency;
        this._maintenanceInterval = process.env.TICKER_MAINTENANCE_INTERVAL ? parseInt(process.env.TICKER_MAINTENANCE_INTERVAL) : 300000;
        this._markets = {};
    }

    async start() {
        for (const connector of this._connectors) {
            this._markets[connector._name] = [];

            const markets = await connector.getAllMarkets();
            for (const market of markets) {
                if (market.baseCurrency !== this._baseCurrency) continue;

                this._markets[connector._name].push(market);
            }
        }
    }

    async tick() {
        const currentTimestamp = Date.now();

        // ticker maintenance every 5 minutes (by default)
        if ((currentTimestamp - this._lastMaintainedTimestamp) > (this._maintenanceInterval)) {
            this._lastMaintainedTimestamp = currentTimestamp;
            for (const connector of this._connectors) {
                for (const tradingPair of this._markets[connector._name]) {
                    const priceData = await connector.getMarketPrice(tradingPair.referenceCurrency, tradingPair.baseCurrency);

                    let minTradeSize = connector.minOrderSize(this._baseCurrency, tradingPair.referenceCurrency);
                    if (connector.minTradeVolumeIsReferenceCurrency()) minTradeSize = minTradeSize / priceData.sellPrice;

                    const referenceCurrencyBalance = await connector.getBalance(tradingPair.referenceCurrency);
                    const baseCurrencyBalance = await connector.getBalance(this._baseCurrency);

                    if (
                        (referenceCurrencyBalance < minTradeSize * priceData.sellPrice) ||
                        (baseCurrencyBalance < minTradeSize)
                    ) {
                        Logger.warning("TickerMaintenance", "balanceCheck", `Found inadequate balance on the ${tradingPair.baseCurrency}-${tradingPair.referenceCurrency} pair`, true);
                        continue;
                    }

                    // set auto-fulfill orders
                    await Promise.all([
                        await connector.addSellOrder(minTradeSize, (priceData.buyPrice + priceData.sellPrice) / 2, tradingPair.referenceCurrency, this._baseCurrency),
                        await connector.addBuyOrder(minTradeSize, (priceData.buyPrice + priceData.sellPrice) / 2, tradingPair.referenceCurrency, this._baseCurrency)
                    ]);
                }
            }
        }
    }

    async shutdown() {}
}