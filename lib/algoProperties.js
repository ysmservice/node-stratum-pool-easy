var bignum = require('bignum');
var multiHashing = require('multi-hashing');
var util = require('./util.js');

var diff1 = global.diff1 = 0x00000000ffff0000000000000000000000000000000000000000000000000000;

var algos = module.exports = global.algos = {
    sha256: {
        hash: function(){
            return function(){
                return util.sha256d.apply(this, arguments);
            }
        }
    },
    scrypt: {
        multiplier: Math.pow(2, 16),
        hash: function(coinConfig){
            var nValue = coinConfig.nValue || 1024;
            var rValue = coinConfig.rValue || 1;
            return function(data){
                return multiHashing.scrypt(data,nValue,rValue);
            }
        }
    },
    x11: {
        hash: function(){
            return function(){
                return multiHashing.x11.apply(this, arguments);
            }
        }
    },
    x13: {
        hash: function(){
            return function(){
                return multiHashing.x13.apply(this, arguments);
            }
        }
    },
    x15: {
        hash: function(){
            return function(){
                return multiHashing.x15.apply(this, arguments);
            }
        }
    },
    nist5: {
        hash: function(){
            return function(){
                return multiHashing.nist5.apply(this, arguments);
            }
        }
    },
    quark: {
        hash: function(){
            return function(){
                return multiHashing.quark.apply(this, arguments);
            }
        }
    },
    keccak: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            if (coinConfig.normalHashing === true) {
                return function (data, nTimeInt) {
                    return multiHashing.keccak(multiHashing.keccak(Buffer.concat([data, new Buffer(nTimeInt.toString(16), 'hex')])));
                };
            }
            else {
                return function () {
                    return multiHashing.keccak.apply(this, arguments);
                }
            }
        }
    },
    blake: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.blake.apply(this, arguments);
            }
        }
    },
    equihash: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            // より柔軟なパラメータ設定をサポート
            let parameters = coinConfig.parameters;
            if (!parameters) {
                switch(coinConfig.symbol.toLowerCase()) {
                    case 'zcash':
                    case 'zec':
                        parameters = { N: 200, K: 9, personalization: 'ZcashPoW' };
                        break;
                    case 'zen':
                        parameters = { N: 192, K: 7, personalization: 'ZenProtocol' };
                        break;
                    case 'kmd':
                        parameters = { N: 200, K: 9, personalization: 'ZcashPoW' };
                        break;
                    default:
                        parameters = { N: 200, K: 9, personalization: 'ZcashPoW' };
                }
            }
            return function(){
                return multiHashing.equihash.apply(this, [].slice.call(arguments).concat([parameters]));
            }
        }
    },
    yescrypt: {
        multiplier: Math.pow(2, 16),
        hash: function(){
            return function(){
                return multiHashing.yescrypt.apply(this, arguments);
            }
        }
    },
    yescryptR8: {
        multiplier: Math.pow(2, 16),
        hash: function(){
            return function(){
                return multiHashing.yescryptR8.apply(this, arguments);
            }
        }
    },
    yescryptR16: {
        multiplier: Math.pow(2, 16),
        hash: function(){
            return function(){
                return multiHashing.yescryptR16.apply(this, arguments);
            }
        }
    },
    yescryptR32: {
        multiplier: Math.pow(2, 16),
        hash: function(){
            return function(){
                return multiHashing.yescryptR32.apply(this, arguments);
            }
        }
    },
    verushash: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.verushash.apply(this, arguments);
            }
        }
    },
    ghostrider: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.ghostrider.apply(this, arguments);
            }
        }
    },
    beamhash: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            let parameters = coinConfig.beamHashParams || {
                version: 3,
                N: 144,
                K: 5
            };
            return function(){
                return multiHashing.beamhash.apply(this, [].slice.call(arguments).concat([parameters]));
            }
        }
    },
    verthash: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.verthash.apply(this, arguments);
            }
        }
    },
    heavyhash: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.heavyhash.apply(this, arguments);
            }
        }
    },
    x16rv2: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.x16rv2.apply(this, arguments);
            }
        }
    },
    ethash: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            let parameters = coinConfig.ethashParams || {
                epochLength: 30000,
                dagSize: 4294967296,
                cacheSize: 16777216
            };
            return function(){
                if (!multiHashing.ethash_init_epoch(Math.floor(arguments[1].height / parameters.epochLength))) {
                    throw new Error('Failed to initialize epoch');
                }
                return multiHashing.ethash_hash.apply(this, [].slice.call(arguments).concat([Math.floor(arguments[1].height / parameters.epochLength)]));
            }
        }
    },
    xelishash: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            const version = coinConfig.xelisVersion || 2;
            return function(){
                return version === 2 ?
                    multiHashing.xelishash_v2.apply(this, arguments) :
                    multiHashing.xelishash.apply(this, arguments);
            }
        }
    },
    handshake: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.handshake.apply(this, arguments);
            }
        }
    },
    kaspa: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.kaspa_pow.apply(this, arguments);
            }
        }
    },
    zano: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.zano_pow.apply(this, arguments);
            }
        }
    },
    nexa: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.nexa_hash.apply(this, arguments);
            }
        }
    },
    yespowerr16: {
        multiplier: Math.pow(2, 16),
        hash: function(){
            return function(){
                return multiHashing.yespowerr16.apply(this, arguments);
            }
        }
    },
    firopow: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            let parameters = coinConfig.firopowParams || {
                epoch_length: 7500,
                dag_size: 2147483648,
                cache_size: 16777216
            };
            return function(){
                return multiHashing.firopow.apply(this, [].slice.call(arguments).concat([parameters]));
            }
        }
    },
    cortex: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.cortex.apply(this, arguments);
            }
        }
    },
    meowpow: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.meowpow.apply(this, arguments);
            }
        }
    },
    ubqhash: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            let parameters = coinConfig.ubqhashParams || {
                epoch_length: 30000,
                dag_size: 4294967296,
                cache_size: 16777216
            };
            return function(){
                return multiHashing.ubqhash.apply(this, [].slice.call(arguments).concat([parameters]));
            }
        }
    },
    kawpow: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            let parameters = coinConfig.kawpowParams || {
                epoch_length: 7500,
                dag_size: 2147483648,
                cache_size: 16777216
            };
            return function(){
                return multiHashing.kawpow.apply(this, [].slice.call(arguments).concat([parameters]));
            }
        }
    },
    progpow: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            let parameters = coinConfig.progpowParams || {
                epoch_length: 7500,
                dag_size: 2147483648,
                cache_size: 16777216
            };
            return function(){
                return multiHashing.progpow.apply(this, [].slice.call(arguments).concat([parameters]));
            }
        }
    },
    progpowz: {
        multiplier: Math.pow(2, 8),
        hash: function(){
            return function(){
                return multiHashing.progpowz.apply(this, arguments);
            }
        }
    },
    equihashKMD: {
        multiplier: Math.pow(2, 8),
        hash: function(coinConfig){
            return function(data, height){
                if (coinConfig.symbol === 'KMD' && height > 0) {
                    // KMD notaryPay処理
                    if (height > coinConfig.notaryStartHeight) {
                        let notarydata = multiHashing.equihash(data, 200, 9);
                        if (notarydata && notarydata.indexOf('notarypaycontent') !== -1) {
                            return notarydata;
                        }
                    }
                }
                return multiHashing.equihash.apply(this, arguments);
            }
        }
    }
};

// マイニングアルゴリズムのタイプを定義
var algoTypes = {
    'sha256': 'POW',
    'scrypt': 'POW',
    'x11': 'POW',
    'x13': 'POW',
    'x15': 'POW',
    'nist5': 'POW',
    'quark': 'POW',
    'keccak': 'POW',
    'blake': 'POW',
    'equihash': 'EQUIHASH',
    'yescrypt': 'POW',
    'verushash': 'POW',
    'ghostrider': 'POW',
    'beamhash': 'BEAMHASH',
    'verthash': 'POW',
    'heavyhash': 'POW',
    'x16rv2': 'POW',
    'ethash': 'ETHASH',
    'xelishash': 'POW',
    'handshake': 'POW',
    'kaspa': 'POW',
    'zano': 'POW',
    'nexa': 'POW',
    'yespowerr16': 'POW',
    'firopow': 'POW',
    'cortex': 'POW',
    'meowpow': 'POW',
    'ubqhash': 'ETHASH',
    'kawpow': 'POW',
    'progpowz': 'POW',
    'yescryptR8': 'POW',
    'yescryptR16': 'POW',
    'yescryptR32': 'POW',
    'equihashKMD': 'EQUIHASH'
};

for (var algo in algos){
    if (!algos[algo].multiplier)
        algos[algo].multiplier = 1;
    // アルゴリズムタイプを追加
    algos[algo].type = algoTypes[algo] || 'POW';
}
