import BaseProvider from "./BaseProvider.js";
import { encode as base64Encode } from "js-base64";
import RequestHelper from "../RequestHelper.js";

export default class TradeOgre extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://tradeogre.com/api/v1", 0.2, 0.2, 0.01, true, [1, 0], "-", "TradeOgre");
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

    async getMarketPrice(referenceCurrency, baseCurrency="RTM") {
        try {
            const marketData = await (await this._requestHelper.get(`${this._apiUrl}/orders/${referenceCurrency.toUpperCase()}-${baseCurrency.toUpperCase()}`)).json();

            if (!marketData.success) return { success: false, error: marketData.error };

            const askKeys = Object.keys(marketData.sell);
            const ask = { price: parseFloat(askKeys[0]), depth: marketData.sell[askKeys[0]] };

            const bidKeys = Object.keys(marketData.buy);
            const bid = { price: parseFloat(bidKeys[bidKeys.length - 1]), depth: parseFloat(marketData.buy[bidKeys[bidKeys.length - 1]]) };
            return {
                success: true,
                buyPrice: parseFloat(ask.price),
                buyDepth: parseFloat(ask.depth),
                sellPrice: parseFloat(bid.price),
                sellDepth: parseFloat(bid.depth)
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get market price"
            };
        }
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

        this._minTradeVolumes[this.coinToExchangePair("BTC")] = 0.00005;
        this._minTradeVolumes[this.coinToExchangePair("USDT")] = 1;
        this._minTradeVolumes[this.coinToExchangePair("LTC")] = 0.01;
    }

    // TradeOgre makes buy and sell really intuitive :)
    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        try {
            const res = await (await (this._requestHelper.post(
                `${this._apiUrl}/order/${isBuy ? "buy" : "sell"}`,
                new URLSearchParams({
                    "market": this.coinsToExchangePair([baseCurrency, referenceCurrency]),
                    "quantity": baseAmount.toString(),
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
        } catch (e) {
            return false;
        }
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, true);
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, false);
    }

    async cancelAllPending() {
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

        return true;
    }

    async orderStatus(orderId) {
        try {
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
        } catch (e) {
            return {
                success: false,
                error: "Failed to get order status"
            };
        }
    }

    async getBalance(currency) {
        try {
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
        } catch (e) {
            return {
                success: false,
                error: "Failed to get balance"
            };
        }
    }
}