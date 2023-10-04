import BaseProvider from "./BaseProvider.js";
import RequestHelper from "../RequestHelper.js";
import { createHmac } from 'crypto';
import Logger from "../Logger.js";

export default class TxBit extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.txbit.io/api", 0, 0, 400, true, [0, 1], "/", "TxBit");
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1,
            }
        }, true);
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        try {
            const markets = await (await this._requestHelper.get(`${this._apiUrl}/public/getmarkets`, false)).json();

            for (const market of markets.result) {
                if (market.MarketCurrency !== "RTM") continue;

                this._tradingPairs[market.BaseCurrency] = { pair: market.MarketName, enabled: true };
                this._minTradeVolumes[market.MarketName] = market.MinTradeSize;
            }
        } catch (e) {
            Logger.error(this._name, "initialize_allTradingPairs", `Failed to initialize trading pair data (${JSON.stringify(e)})`);
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency="RTM") {
        try {
            const orderBookData = await (await this._requestHelper.get(`${this._apiUrl}/public/getorderbook?market=${baseCurrency.toUpperCase()}/${referenceCurrency.toUpperCase()}&type=both`, false)).json();
            const orderBookAsks = orderBookData.result.sell.sort((a, b) => a.Rate - b.Rate);
            const orderBookBids = orderBookData.result.buy.sort((a, b) => b.Rate - a.Rate);

            return {
                success: true,
                sellPrice: orderBookBids[0].Rate,
                sellDepth: orderBookBids[0].Quantity,
                buyPrice: orderBookAsks[0].Rate,
                buyDepth: orderBookAsks[0].Quantity
            };
        } catch (e) {
            return {
                success: false,
                error: `Failed to get market price (${JSON.stringify(e)})`
            };
        }
    }

    privateQueryParams() {
        return `apikey=${this._apiKey}&nonce=${Date.now()}`;
    }

    signHeader(url) {
        return createHmac("sha512", this._apiSecret).update(url).digest("hex").toUpperCase();
    }

    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, side) {
        try {
            const url = `${this._apiUrl}/market/${side}limit?market=${this.coinsToExchangePair([baseCurrency.toUpperCase(), referenceCurrency.toUpperCase()])}&quantity=${baseAmount}&rate=${price}&${this.privateQueryParams()}`;
            const status = await (await this._requestHelper.get(url, true, { apisign: this.signHeader(url) })).json();
            if (!status.success) {
                return false;
            }
            this._pendingTrades.push(status.result.uuid);
            return true;
        } catch (e) {
            return false;
        }
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, "buy");
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, "sell");
    }

    async cancelAllPending() {
        try {
            for (const tradeUuid of this._pendingTrades) {
                const url = `${this._apiUrl}/market/cancel?uuid=${tradeUuid}&${this.privateQueryParams()}`;
                await this._requestHelper.get(url, true, { apisign: this.signHeader(url) });
            }
            this._pendingTrades = [];
            return true;
        } catch (e) {
            return false;
        }
    }

    async orderStatus(orderId) {
        try {
            const url = `${this._apiUrl}/account/getorder?uuid=${orderId}&${this.privateQueryParams()}`;
            const orderStatus = await (await this._requestHelper.get(url, true, { apisign: this.signHeader(url) })).json();

            if (!orderStatus.success) {
                return {
                    success: false,
                    error: orderStatus.message
                };
            }

            return {
                success: true,
                type: orderStatus.result.Type,
                market: orderStatus.result.Exchange,
                price: orderStatus.result.Price,
                quantityLeft: orderStatus.result.QuantityRemaining
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get order status"
            };
        }
    }

    async getBalance(currency) {
        try {
            const url = `${this._apiUrl}/account/getbalance?currency=${currency.toUpperCase()}&${this.privateQueryParams()}`;
            const balance = await (await this._requestHelper.get(url, true, { apisign: this.signHeader(url) })).json();

            if (!balance.success) {
                return {
                    success: false,
                    error: balance.message
                };
            }

            return {
                success: true,
                total: balance.result.Balance,
                available: balance.result.Available
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get balance"
            };
        }
    }
}
