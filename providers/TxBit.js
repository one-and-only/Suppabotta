import BaseProvider from "../providers/BaseProvider.js";
import RequestHelper from "../RequestHelper.js";
import { createHmac } from 'crypto';
import Logger from "../Logger.js";

export default class TxBit extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.txbit.io/api", 0, 0, 400, true, "TxBit");
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
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/public/getmarkets`, false)).json();

        for (const market of markets.result) {
            if (market.MarketCurrency !== "RTM") continue;

            this._tradingPairs[market.BaseCurrency] = { pair: market.MarketName, enabled: true };
            this._minTradeVolumes[market.MarketName] = market.MinTradeSize;
        }
    }

    async getMarketPrice(referenceCurrency) {
        const orderBookData = await (await this._requestHelper.get(`${this._apiUrl}/public/getorderbook?market=RTM/${referenceCurrency.toUpperCase()}&type=both`, false)).json();
        const orderBookAsks = orderBookData.result.sell.sort((a, b) => a.Rate - b.Rate);
        const orderBookBids = orderBookData.result.buy.sort((a, b) => b.Rate - a.Rate);

        return {
            success: true,
            sellPrice: orderBookBids[0].Rate,
            sellDepth: orderBookBids[0].Quantity,
            buyPrice: orderBookAsks[0].Rate,
            buyDepth: orderBookAsks[0].Quantity
        };
    }

    privateQueryParams() {
        return `apikey=${this._apiKey}&nonce=${Date.now()}`;
    }

    signHeader(url) {
        return createHmac("sha512", this._apiSecret).update(url).digest("hex").toUpperCase();
    }

    async submitOrder(amount, price, referenceCurrency, side) {
        const url = `${this._apiUrl}/market/${side}limit?market=${this.coinToExchangePair(referenceCurrency.toUpperCase())}&quantity=${amount}&rate=${price}&${this.privateQueryParams()}`;
        const status = await (await this._requestHelper.get(url, true, { apisign: this.signHeader(url) })).json();
        if (!status.success) {
            Logger.error(this._name, `submitOrder_${side}`, `Failed to submit order (${status.message})`);
            return false;
        }
        this._pendingTrades.push(status.result.uuid);
        return true;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, "buy");
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, "sell");
    }

    async cancelAllPending() {
        for (const tradeUuid of this._pendingTrades) {
            const url = `${this._apiUrl}/market/cancel?uuid=${tradeUuid}&${this.privateQueryParams()}`;
            await this._requestHelper.get(url, true, { apisign: this.signHeader(url) });
        }
        this._pendingTrades = [];
        return true;
    }

    async orderStatus(orderId) {
        const url = `${this._apiUrl}/account/getorder?uuid=${orderId}&${this.privateQueryParams()}`;
        const orderStatus = await (await this._requestHelper.get(url, true, { apisign: this.signHeader(url) })).json();

        if (!orderStatus.success) {
            Logger.error(this._name, "orderStatus", `Failed to get the order status for order ID '${orderId}' (${orderStatus.message})`);
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
    }

    async getBalance(currency) {
        const url = `${this._apiUrl}/account/getbalance?currency=${currency.toUpperCase()}&${this.privateQueryParams()}`;
        const balance = await (await this._requestHelper.get(url, true, { apisign: this.signHeader(url) })).json();

        if (!balance.success) {
            Logger.error(this._name, "getBalance", `Failed to get ${currency} balance (${balance.message})`);
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
    }
}