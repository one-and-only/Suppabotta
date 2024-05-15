export const apiRateLimits = {
    "CoinEx": {
        public: {
            amount: 10,
            interval: 1
        }
    },
    "TradeOgre": {
        public: {
            amount: 2000,
            interval: 60000,
        }
    },
    "DexTrade": {
        public: {
            amount: -1,
            interval: -1
        }
    },
    "Xeggex": {
        public: {
            amount: -1,
            interval: -1
        }
    },
    "NonKYC": {
        public: {
            amount: -1,
            interval: -1
        }
    },
};