import fetch from "node-fetch";
import BaseProvider from "./BaseProvider";
import { encode as base64Encode } from "base-64";

export default class TradeOgre extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://tradeogre.com/api/v1");
    }

    async getMarketPrice(referenceCurrency) {
        const marketData = await (await fetch(`${this._apiUrl}/ticker/${referenceCurrency.toUpperCase()}-RTM`)).json();
        if (!marketData.success) return { success: false, error: marketData.error };

        return {
            success: true,
            buy: marketData.ask,
            sell: marketData.bid,
        };
    }

    // TradeOgre makes buy and sell really intuitive :)
    async submitOrder(amount, price, referenceCurrency, isBuy) {
        const res = await (await fetch(`${this._apiUrl}/order/${isBuy ? "buy" : "sell"}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            },
            body: new URLSearchParams({
                "market": `${referenceCurrency.toUpperCase()}-RTM`,
                "quantity": amount.toString(),
                "price": price.toString()
            })
        })).json();

        if (res?.uuid)
            this._pendingOrders.push(res.uuid);

        return res.success;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    // TODO fix this
    // wtf was I doing?! lmaoooo
    async cancelAllPending() {
        // there aren't any pending orders
        if (this._pendingTrades.length < 1) return true;

        const res = await (await fetch(`${this._apiUrl}/order/${isBuy ? "buy" : "sell"}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            },
            body: new URLSearchParams({
                "uuid": "all",
            })
        })).json();

        return res.success;
    }

    async orderStatus(orderId) {
        const orderStatus = await (await fetch(`${this._apiUrl}/account/order/${orderId}`, {
            method: "GET",
            headers: {
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            }
        })).json();

        if (!orderStatus.success) return { success: false, error: orderStatus.error };

        return {
            success: true,
            type: orderStatus.type,
            market: orderStatus.market,
            price: orderStatus.price,
            quantityLeft: orderStatus.quantity - orderStatus.fulfilled
        };
    }

    async getBalance(currency) {
        const balance = await (await fetch(`${this._apiUrl}/account/balance`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
            },
            body: new URLSearchParams({
                "currency": currency.toUpperCase(),
            })
        })).json();

        if (!balance.success) return { success: false, error: balance.error };

        return {
            success: true,
            total: balance.balance,
            available: balance.available
        }
    }
}