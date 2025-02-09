var http = require('http');
var cp = require('child_process');
var events = require('events');

var async = require('async');

function DaemonInterface(daemons, logger){

    //private members
    var _this = this;
    logger = logger || function(severity, message){
        console.log(severity + ': ' + message);
    };

    var instances = (function(){
        for (var i = 0; i < daemons.length; i++)
            daemons[i]['index'] = i;
        return daemons;
    })();

    // コインタイプごとのRPCメソッドマッピング
    var rpcMapping = {
        'default': {
            getInfo: 'getinfo',
            getBlock: 'getblock',
            getBlockHash: 'getblockhash',
            getBlockTemplate: 'getblocktemplate',
            submitBlock: 'submitblock',
            validateAddress: 'validateaddress'
        },
        'ethereum': {
            getInfo: 'eth_getBlockByNumber',
            getBlock: 'eth_getBlockByHash',
            getBlockHash: 'eth_getBlockByNumber',
            getBlockTemplate: 'eth_getWork',
            submitBlock: 'eth_submitWork',
            validateAddress: 'eth_getCode'
        },
        'beam': {
            getInfo: 'getinfo',
            getBlock: 'getblock',
            getBlockHash: 'getblockhash',
            getBlockTemplate: 'getblocktemplate',
            submitBlock: 'submitblock',
            validateAddress: 'validateaddress'
        },
        'vertcoin': {
            getInfo: 'getinfo',
            getBlock: 'getblock',
            getBlockHash: 'getblockhash',
            getBlockTemplate: 'getblocktemplate',
            submitBlock: 'submitblock',
            validateAddress: 'validateaddress'
        },
        'zcash': {
            getInfo: 'getinfo',
            getBlock: 'getblock',
            getBlockHash: 'getblockhash',
            getBlockTemplate: 'getblocktemplate',
            submitBlock: 'submitblock',
            validateAddress: 'z_validateaddress',
            getAddressBalance: 'z_getbalance',
            getAddressInfo: 'z_getbalance',
            sendToAddress: 'z_sendmany'
        },
        'equihash': {
            getInfo: 'getinfo',
            getBlock: 'getblock',
            getBlockHash: 'getblockhash',
            getBlockTemplate: 'getblocktemplate',
            submitBlock: 'submitblock',
            validateAddress: 'validateaddress'
        }
    };

    function init(){
        isOnline(function(online){
            if (online)
                _this.emit('online');
        });
    }

    function isOnline(callback){
        cmd('getpeerinfo', [], function(results){
            var allOnline = results.every(function(result){
                return !results.error;
            });
            callback(allOnline);
            if (!allOnline)
                _this.emit('connectionFailed', results);
        });
    }

    function performHttpRequest(instance, jsonData, callback){
        var options = {
            hostname: (typeof(instance.host) === 'undefined' ? '127.0.0.1' : instance.host),
            port    : instance.port,
            method  : 'POST',
            auth    : instance.user + ':' + instance.password,
            headers : {
                'Content-Length': jsonData.length
            }
        };

        // Ethereumノードの場合はヘッダーを追加
        if (instance.coinType === 'ethereum') {
            options.headers['Content-Type'] = 'application/json';
        }

        var parseJson = function(res, data){
            var dataJson;

            if (res.statusCode === 401){
                logger('error', 'Unauthorized RPC access - invalid RPC username or password');
                return;
            }

            try{
                dataJson = JSON.parse(data);
                
                // Ethereumの結果形式を標準化
                if (instance.coinType === 'ethereum' && dataJson.result) {
                    dataJson = {
                        error: null,
                        result: dataJson.result,
                        id: dataJson.id
                    };
                }
            }
            catch(e){
                if (data.indexOf(':-nan') !== -1){
                    data = data.replace(/:-nan,/g, ":0");
                    parseJson(res, data);
                    return;
                }
                logger('error', 'Could not parse rpc data from daemon instance  ' + instance.index
                    + '\nRequest Data: ' + jsonData
                    + '\nReponse Data: ' + data);

            }
            if (dataJson)
                callback(dataJson.error, dataJson, data);
        };

        var req = http.request(options, function(res) {
            var data = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                data += chunk;
            });
            res.on('end', function(){
                parseJson(res, data);
            });
        });

        req.on('error', function(e) {
            if (e.code === 'ECONNREFUSED')
                callback({type: 'offline', message: e.message}, null);
            else
                callback({type: 'request error', message: e.message}, null);
        });

        req.end(jsonData);
    }

    function batchCmd(cmdArray, callback){
        var requestJson = [];

        for (var i = 0; i < cmdArray.length; i++){
            // コインタイプに応じてRPCメソッド名を変換
            var methodName = cmdArray[i][0];
            var coinType = instances[0].coinType || 'default';
            if (rpcMapping[coinType] && rpcMapping[coinType][methodName]) {
                methodName = rpcMapping[coinType][methodName];
            }

            requestJson.push({
                method: methodName,
                params: cmdArray[i][1],
                id: Date.now() + Math.floor(Math.random() * 10) + i
            });
        }

        var serializedRequest = JSON.stringify(requestJson);

        performHttpRequest(instances[0], serializedRequest, function(error, result){
            callback(error, result);
        });
    }

    function cmd(method, params, callback, streamResults, returnRawData){
        var results = [];

        async.each(instances, function(instance, eachCallback){
            // コインタイプに応じてRPCメソッド名を変換
            var coinType = instance.coinType || 'default';
            if (rpcMapping[coinType] && rpcMapping[coinType][method]) {
                method = rpcMapping[coinType][method];
            }

            var itemFinished = function(error, result, data){
                var returnObj = {
                    error: error,
                    response: (result || {}).result,
                    instance: instance
                };
                if (returnRawData) returnObj.data = data;
                if (streamResults) callback(returnObj);
                else results.push(returnObj);
                eachCallback();
                itemFinished = function(){};
            };

            var requestJson = JSON.stringify({
                method: method,
                params: params,
                id: Date.now() + Math.floor(Math.random() * 10)
            });

            performHttpRequest(instance, requestJson, function(error, result, data){
                itemFinished(error, result, data);
            });

        }, function(){
            if (!streamResults){
                callback(results);
            }
        });
    }

    //public members
    this.init = init;
    this.isOnline = isOnline;
    this.cmd = cmd;
    this.batchCmd = batchCmd;
}

DaemonInterface.prototype.__proto__ = events.EventEmitter.prototype;

exports.interface = DaemonInterface;
