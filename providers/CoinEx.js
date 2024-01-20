import RequestHelper from "../RequestHelper.js";
import BaseProvider from "./BaseProvider.js";
import { createHash } from "crypto";

import Bluebird from "bluebird";
const { map: promiseMap } = Bluebird;

export default class CoinEx extends BaseProvider {
    _referenceCurrencies = ["USDT", "USDC", "BTC"];

    constructor(apiSecret, apiKey, baseCurrency) {
        super(apiSecret, apiKey, "https://api.coinex.com/v1", baseCurrency, 0.2, 0.2, 0.3, false, [0, 1], "", "CoinEx");
        this._requestHelper = new RequestHelper({
            public: {
                amount: 20,
                interval: 2
            }
        }, true);
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/market/info`)).json();
        for (const marketKey in markets.data) {
            const market = markets.data[marketKey];
            this._minTradeVolumes[this.coinsToExchangePair([market.trading_name, market.pricing_name])] = parseFloat(market.min_amount);

            if (!marketKey.startsWith(this._baseCurrency)) continue;

            this._tradingPairs[market.pricing_name] = { pair: marketKey, enabled: true };
        }
    }

    async getAllMarkets() {
        const marketData = await (await this._requestHelper.get(`${this._apiUrl}/market/list`)).json();
        const parsedMarkets = [];

        for (const market of marketData.data) {
            for (const referenceCurrency of this._referenceCurrencies) {
                const split = market.split(referenceCurrency);
                if (split[0].length < market.length) {
                    parsedMarkets.push({ referenceCurrency: referenceCurrency, baseCurrency: split[0] });
                    break;
                }
            }
        }

        return parsedMarkets;
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        try {
            const depthInfo = await (await this._requestHelper.get(`${this._apiUrl}/market/depth?market=${baseCurrency.toUpperCase()}${referenceCurrency.toUpperCase()}&limit=50&merge=0`)).json();
            return {
                bid: depthInfo.data.bids.map(val => { return { price: parseFloat(val[0]), amount: parseFloat(val[1]) } }),
                ask: depthInfo.data.asks.map(val => { return { price: parseFloat(val[0]), amount: parseFloat(val[1]) } })
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
            const marketInfo = await (await this._requestHelper.get(`${this._apiUrl}/market/depth?market=${baseCurrency.toUpperCase()}${referenceCurrency.toUpperCase()}&limit=1&merge=0`)).json();

            const ask = marketInfo.data.asks[0];
            const bid = marketInfo.data.bids[0]
            return {
                success: true,
                buyPrice: parseFloat(ask[0]),
                buyDepth: parseFloat(ask[1]),
                sellPrice: parseFloat(bid[0]),
                sellDepth: parseFloat(bid[1])
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get market info"
            };
        }
    }

    createDictText(params) {
        var keys = Object.keys(params).sort();
        var qs = keys[0] + "=" + params[keys[0]];
        for (var i = 1; i < keys.length; i++) {
            qs += "&" + keys[i] + "=" + params[keys[i]];
        }
        return qs;
    }

    createAuthorization(body) {
        return createHash("md5").update(this.createDictText(body) + `&secret_key=${this._apiSecret}`).digest("hex").toUpperCase()
    }

    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        const market = this.coinsToExchangePair([baseCurrency, referenceCurrency]);
        const body = {
            access_id: this._apiKey,
            market: market,
            type: isBuy ? "buy" : "sell",
            amount: baseAmount,
            price: price,
            tonce: Date.now()
        };

        try {
            const response = await this._requestHelper.post(
                `${this._apiUrl}/order/limit`,
                body,
                true,
                {
                    "Content-Type": "application/json",
                    "Authorization": this.createAuthorization(body)
                }
            );
            const responseJson = await response.json();

            if (response.status !== 200 || !responseJson.id) return false;

            this._pendingTrades.push({ id: responseJson.id, referenceCurrency: referenceCurrency, baseCurrency: baseCurrency, amount: baseAmount, price: price, isBuy: isBuy });
            return true;
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
        if (this._pendingTrades.length < 1) return true;

        for (const pendingTrade of this._pendingTrades) {
            const params = {
                access_id: this._apiKey,
                id: pendingTrade.id,
                market: pendingTrade.market,
                tonce: Date.now()
            }

            try {
                const response = await this._requestHelper.request(
                    `${this._apiUrl}/order/pending?${this.createDictText(params)}`,
                    "DELETE",
                    null,
                    true,
                    {
                        "Authorization": this.createAuthorization(params)
                    }
                );

                const responseJson = await response.json();
                if (response.status !== 200 || !responseJson.id) return false;
            } catch (e) {
                continue;
            }
        }

        return true;
    }

    getPendingOrders() {
        return this._pendingTrades;
    }

    async prunePendingOrders() {
        this._pendingTrades = (await promiseMap(
            this._pendingTrades,
            async order => {
                const orderStatus = await this.orderStatus({ id: order.id, market: this.coinsToExchangePair([order.baseCurrency, order.referenceCurrency]) });
                if (orderStatus.success && orderStatus.quantityLeft > 0) return order;

                return "";
            }
        )).filter(x => x !== "");
    }

    async orderStatus(order) {
        const params = {
            access_id: this._apiKey,
            id: order.id,
            market: order.market,
            tonce: Date.now()
        };

        try {
            const response = await this._requestHelper.get(
                `${this._apiUrl}/order/status?${this.createDictText(params)}`,
                true,
                {
                    "Authorization": this.createAuthorization(params)
                }
            );

            const orderStatus = (await response.json()).data;

            if (response.status !== 200) return { success: false }

            return {
                success: true,
                type: orderStatus.type,
                market: market,
                price: orderStatus.price,
                quantityLeft: parseFloat(orderStatus.left)
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get order status"
            };
        }
    }

    async getBalance(currency) {
        const params = {
            access_id: this._apiKey,
            tonce: Date.now()
        };

        try {
            const response = await (await this._requestHelper.get(
                `${this._apiUrl}/balance/info?${this.createDictText(params)}`,
                true,
                {
                    "Authorization": this.createAuthorization(params)
                }
            )).json();

            const currencyData = response.data[currency.toUpperCase()];
            if (!currencyData) {
                return {
                    success: true,
                    total: 0,
                    available: 0
                };
            }

            return {
                success: true,
                total: parseFloat(currencyData.available) + parseFloat(currencyData.frozen),
                available: parseFloat(currencyData.available)
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get balance"
            };
        }
    }
}