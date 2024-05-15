import BaseProvider from "./BaseProvider.js";
import { encode as base64Encode } from "js-base64";

export default class TradeOgre extends BaseProvider {
    constructor(outboundIp, requestHelper, apiSecret, apiKey, baseCurrency) {
        super(outboundIp, requestHelper, apiSecret, apiKey, "https://tradeogre.com/api/v1", baseCurrency, 0.3, 0.3, 0.01, true, [0, 1], "-", "TradeOgre");
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async getAllMarkets() {
        const marketData = await this._requestHelper.get(`${this._apiUrl}/markets`);
        const markets = [];

        for (const market of marketData) {
            const split = Object.keys(market)[0].split("-");
            markets.push({
                referenceCurrency: split[1],
                baseCurrency: split[0]
            });
        }

        return markets;
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        try {
            const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/orders/${this.coinsToExchangePair([baseCurrency, referenceCurrency])}`)).json();

            return {
                bid: Object.keys(orderBook.buy).map(price => { return { price: parseFloat(price), amount: parseFloat(orderBook.buy[price]) } }).reverse(),
                ask: Object.keys(orderBook.sell).map(price => { return { price: parseFloat(price), amount: parseFloat(orderBook.sell[price]) } })
            };
        } catch (e) {
            return {
                bid: [],
                ask: []
            };
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency = "RTM") {
        try {
            const marketData = await this._requestHelper.get(`${this._apiUrl}/orders/${referenceCurrency.toUpperCase()}-${baseCurrency.toUpperCase()}`);

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
        const markets = await this._requestHelper.get(`${this._apiUrl}/markets`);

        for (const marketIdx in markets) {
            const market = markets[marketIdx];

            for (const pair in market) {
                this._tradingPairs[pair.split("-")[1]] = { pair: pair, enabled: true };
                this._minTradeVolumes[pair] = 0;
            }
        }

        this._minTradeVolumes["RTM-BTC"] = 0.00005;
        this._minTradeVolumes["RTM-USDT"] = 1;
        this._minTradeVolumes["RTM-LTC"] = 0.01;
    }

    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        try {
            const res = await (this._requestHelper.post(
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
            ));

            if (res?.uuid) {
                return { success: res.success, id: res.success ? res.uuid : "" };
            }

            return { success: false, id: "" };
        } catch (e) {
            return { success: false, id: "" };
        }
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, true);
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, false);
    }

    async orderStatus(orderId) {
        try {
            const orderStatus = await this._requestHelper.get(
                `${this._apiUrl}/account/order/${orderId}`,
                true,
                {
                    "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
                }
            );

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
            const balance = await this._requestHelper.post(
                `${this._apiUrl}/account/balance`,
                new URLSearchParams({
                    "currency": currency.toUpperCase(),
                }),
                true,
                {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Basic ${base64Encode(`${this._apiKey}:${this._apiSecret}`)}`
                }
            );

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