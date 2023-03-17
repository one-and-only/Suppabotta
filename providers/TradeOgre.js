import BaseProvider from "./../providers/BaseProvider.js";
import { encode as base64Encode } from "js-base64";
import RequestHelper from "../requestHelper.js";

export default class TradeOgre extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://tradeogre.com/api/v1", 0.2, 0.2, 0.01, "TradeOgre");
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

    async getMarketPrice(referenceCurrency) {
        const marketData = await (await this._requestHelper.get(`${this._apiUrl}/ticker/${referenceCurrency.toUpperCase()}-RTM`)).json();
        // technically same response as TO gives
        // should I simplify and return TO response or keep the intent clear?
        if (!marketData.success) return { success: false, error: marketData.error };

        return {
            success: true,
            buy: parseFloat(marketData.ask),
            sell: parseFloat(marketData.bid),
        };
    }

    async allTradingPairs() {
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/markets`)).json();

        for (const marketIdx in markets) {
            const market = markets[marketIdx];
            if (!JSON.stringify(market).includes("RTM"))
                continue;

            for (const pair in market) {
                this._tradingPairs[pair.split("-")[0]] = { pair: pair, enabled: true };
            }
        }
    }

    // TradeOgre makes buy and sell really intuitive :)
    async submitOrder(amount, price, referenceCurrency, isBuy) {
        const res = await (await (this._requestHelper.post(
            `${this._apiUrl}/order/${isBuy ? "buy" : "sell"}`,
            new URLSearchParams({
                "market": `${referenceCurrency.toUpperCase()}-RTM`,
                "quantity": amount.toString(),
                "price": price.toString()
            }),
            true,
            {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            }
        ))).json();

        if (res?.uuid) {
            this._pendingOrders.push(res.uuid);
            return res.success;
        }

        return false;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    async cancelAllPending() {
        // there aren't any pending orders
        if (this._pendingTrades.length < 1) return true;

        for (const pendingTrade in this._pendingTrades) {
            await this._requestHelper.post(
                `${this._apiUrl}/order/cancel`,
                new URLSearchParams({
                    "uuid": pendingTrade,
                }),
                true,
                {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
                }
            );
        }

        return res.success;
    }

    async orderStatus(orderId) {
        const orderStatus = await (await this._requestHelper.get(
            `${this._apiUrl}/account/order/${orderId}`,
            true,
            {
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            }
        )).json();

        if (!orderStatus?.success) return { success: false, error: orderStatus.error };

        return {
            success: true,
            type: orderStatus.type,
            market: orderStatus.market,
            price: orderStatus.price,
            quantityLeft: orderStatus.quantity - orderStatus.fulfilled
        };
    }

    async getBalance(currency) {
        const balance = await (await this._requestHelper.post(
            `${this._apiUrl}/account/balance`,
            new URLSearchParams({
                "currency": currency.toUpperCase(),
            }),
            true,
            {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            }
        )).json();

        if (!balance.success) return { success: false, error: balance.error };

        return {
            success: true,
            total: parseFloat(balance.balance),
            available: parseFloat(balance.available)
        }
    }
}