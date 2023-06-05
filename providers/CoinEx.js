import RequestHelper from "../RequestHelper.js";
import BaseProvider from "./BaseProvider.js";
import { createHash } from "crypto";

export default class CoinEx extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.coinex.com/v1", 0.1, 0.1, 0.3, false, [0, 1], "", "CoinEx");
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
            if (!marketKey.startsWith("RTM")) continue;

            const market = markets.data[marketKey];
            this._tradingPairs[market.pricing_name] = { pair: marketKey, enabled: true };
            this._minTradeVolumes[marketKey] = market.min_amount;
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency="RTM") {
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
                JSON.stringify(body),
                true,
                {
                    "Content-Type": "application/json",
                    "Authorization": this.createAuthorization(body)
                }
            );
            const responseJson = await response.json();

            if (response.status !== 200 || !responseJson.id) return false;

            this._pendingTrades.push({ market: market, id: responseJson.id });
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