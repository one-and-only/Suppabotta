import RequestHelper from "../RequestHelper.js";
import BaseProvider from "./BaseProvider.js";
import { createHmac } from "crypto";

export default class CoinEx extends BaseProvider {
    _referenceCurrencies = ["USDT", "USDC", "BTC"];

    constructor(outboundIp, apiSecret, apiKey, baseCurrency) {
        super(outboundIp, apiSecret, apiKey, "https://api.coinex.com/v2", baseCurrency, 0.2, 0.2, 0.3, false, [0, 1], "", "CoinEx");
        this._requestHelper = new RequestHelper(
            {
                public: {
                    amount: 10,
                    interval: 1
                }
            },
            true,
            this._outboundIp
        );
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const markets = await this._requestHelper.get(`${this._apiUrl}/spot/market`);
        for (const market of markets.data) {
            this._minTradeVolumes[this.coinsToExchangePair([market.trading_name, market.pricing_name])] = parseFloat(market.min_amount);

            if (!market.base_ccy.startsWith(this._baseCurrency)) continue;

            this._tradingPairs[market.quote_ccy] = { pair: market.market, enabled: true };
        }
    }

    async getAllMarkets() {
        return (await this._requestHelper.get(`${this._apiUrl}/spot/market`)).data.map(market => {
            return { referenceCurrency: market.quote_ccy, baseCurrency: market.base_ccy };
        });
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        try {
            const depthInfo = await this._requestHelper.get(`${this._apiUrl}/spot/depth?market=${this.coinsToExchangePair([baseCurrency.toUpperCase(), referenceCurrency.toUpperCase()])}&limit=50&interval=0`);
            return {
                bid: depthInfo.data.depth.bids.map(val => { return { price: parseFloat(val[0]), amount: parseFloat(val[1]) } }),
                ask: depthInfo.data.depth.asks.map(val => { return { price: parseFloat(val[0]), amount: parseFloat(val[1]) } })
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
            const marketInfo = await this._requestHelper.get(`${this._apiUrl}/spot/depth?market=${this.coinsToExchangePair([baseCurrency.toUpperCase(), referenceCurrency.toUpperCase()])}&limit=5&interval=0`);

            const ask = marketInfo.data.depth.asks[0];
            const bid = marketInfo.data.depth.bids[0];

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

    /**
     * 
     * @param {string} method HTTP method used in the authorized request
     * @param {object|""} body if the request uses HTTP body (JSON for this bot), then this is the body as an object. Omit the effect of this with an empty string (`""`)
     * @param {string} apiPath URN excluding coinex base URL of the API endpoint you're visiting
     * @returns 
     */
    createAuthorizationHeaders(method, body, apiPath) {
        const timestamp = Date.now();
        const signature = createHmac("sha256", this._apiSecret).update(`${method}${apiPath}${method === "POST" ? JSON.stringify(body) : ""}${timestamp}`).digest("hex").toUpperCase();

        return {
            "X-COINEX-KEY": this._apiKey,
            "X-COINEX-SIGN": signature,
            "X-COINEX-TIMESTAMP": timestamp
        }
    }

    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        const market = this.coinsToExchangePair([baseCurrency, referenceCurrency]);
        const body = {
            market: market,
            market_type: "SPOT",
            type: "limit",
            side: isBuy ? "buy" : "sell",
            amount: baseAmount,
            price: price
        };

        try {
            const response = await this._requestHelper.post(
                `${this._apiUrl}/spot/order`,
                body,
                true,
                {
                    "Content-Type": "application/json",
                    ...this.createAuthorizationHeaders("POST", body, `/v2/spot/order`)
                }
            );

            if (!response.data.order_id) return { success: false, error: response.message };

            return { success: true, id: response.order_id };
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

    async orderStatus(order) {
        try {
            const orderStatus = await this._requestHelper.get(
                `${this._apiUrl}/order/status?order_id=${order.id}&market=${order.market}`,
                true,
                this.createAuthorizationHeaders("GET", "", `/v2/order/status?order_id=${order.id}&market=${order.market}`)
            );

            if (!orderStatus.order_id) return { success: false };

            return {
                success: true,
                type: orderStatus.side,
                market: market,
                price: orderStatus.price,
                quantityLeft: parseFloat(orderStatus.unfilled_amount)
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
            const response = await this._requestHelper.get(
                `${this._apiUrl}/assets/spot/balance`,
                true,
                this.createAuthorizationHeaders("GET", "", `/v2/assets/spot/balance`)
            );

            if (!Array.isArray(response.data)) {
                return {
                    success: false,
                    error: response.message
                };
            }

            const currencyData = response.data?.filter(x => x.ccy === currency.toUpperCase())[0];

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