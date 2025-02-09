var events = require('events');
var crypto = require('crypto');

var bignum = require('bignum');



var util = require('./util.js');
var blockTemplate = require('./blockTemplate.js');
var ethashBlockTemplate = require('./ethashBlockTemplate.js');

// コインタイプに応じたBlockTemplateクラスを選択
function selectBlockTemplate(options) {
    switch(options.coin.type) {
        case 'ethereum':
            return ethashBlockTemplate;
        default:
            return blockTemplate;
    }
}



//Unique extranonce per subscriber
var ExtraNonceCounter = function(configInstanceId){

    var instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
    var counter = instanceId << 27;

    this.next = function(){
        var extraNonce = util.packUInt32BE(Math.abs(counter++));
        return extraNonce.toString('hex');
    };

    this.size = 4; //bytes
};

//Unique job per new block template
var JobCounter = function(){
    var counter = 0;

    this.next = function(){
        counter++;
        if (counter % 0xffff === 0)
            counter = 1;
        return this.cur();
    };

    this.cur = function () {
        return counter.toString(16);
    };
};

/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
**/
var JobManager = module.exports = function JobManager(options){


    //private members

    var _this = this;
    var jobCounter = new JobCounter();

    var shareMultiplier = algos[options.coin.algorithm].multiplier;
    
    //public members

    this.extraNonceCounter = new ExtraNonceCounter(options.instanceId);
    this.extraNoncePlaceholder = new Buffer('f000000ff111111f', 'hex');
    this.extraNonce2Size = this.extraNoncePlaceholder.length - this.extraNonceCounter.size;

    this.currentJob;
    this.validJobs = {};

    var hashDigest = algos[options.coin.algorithm].hash(options.coin);

    var coinbaseHasher = (function(){
        switch(options.coin.algorithm){
            case 'keccak':
            case 'fugue':
            case 'groestl':
                if (options.coin.normalHashing === true)
                    return util.sha256d;
                else
                    return util.sha256;
            default:
                return util.sha256d;
        }
    })();


    var blockHasher = (function () {
        switch (options.coin.algorithm) {
            case 'scrypt':
            case 'scrypt-jane':
                if (options.coin.reward === 'POS') {
                    return function (d) {
                        return util.reverseBuffer(hashDigest.apply(this, arguments));
                    };
                }
                break;
            case 'scrypt-n':
                return function (d) {
                    return util.reverseBuffer(util.sha256d(d));
                };
            case 'ghostrider':
            case 'firopow':
            case 'kawpow':
            case 'progpow':
            case 'ethash':
                return function (header) {
                    return util.reverseBuffer(util.sha256d(header));
                };
            case 'equihash':
                return function (header) {
                    return util.sha256d(header);
                };
            case 'verushash':
                if (options.coin.symbol === 'VRSC') {
                    return function (header) {
                        return util.sha256(header);
                    };
                }
                break;
            case 'yespowerr16':
            case 'yescrypt':
            case 'yescryptR8':
            case 'yescryptR16':
            case 'yescryptR32':
                return function (header) {
                    return util.reverseBuffer(hashDigest.apply(this, arguments));
                };
        }
        // デフォルトの処理
        return function () {
            return util.reverseBuffer(hashDigest.apply(this, arguments));
        };
    })();

    this.updateCurrentJob = function(rpcData){
        var SelectedBlockTemplate = selectBlockTemplate(options);
        var tmpBlockTemplate = new SelectedBlockTemplate(
            jobCounter.next(),
            rpcData,
            _this.extraNoncePlaceholder,
            options.recipients,
            options.poolAddressScript,
            options.poolHex,
            options.coin,
            options.daemon
        );

        _this.currentJob = tmpBlockTemplate;
        _this.emit('updatedBlock', tmpBlockTemplate, true);
        _this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;
    };

    //returns true if processed a new block
    this.processTemplate = function(rpcData){
        var isNewBlock = typeof(_this.currentJob) === 'undefined';

        // イーサリアムの場合はheightの代わりにブロック番号を使用
        if (options.coin.type === 'ethereum') {
            if (!isNewBlock && _this.currentJob.rpcData[0] !== rpcData[0]) {
                isNewBlock = true;
                if (parseInt(rpcData[0].slice(2), 16) < parseInt(_this.currentJob.rpcData[0].slice(2), 16)) {
                    return false;
                }
            }
        } else {
            if (!isNewBlock && _this.currentJob.rpcData.previousblockhash !== rpcData.previousblockhash) {
                isNewBlock = true;
                if (rpcData.height < _this.currentJob.rpcData.height) {
                    return false;
                }
            }
        }

        if (!isNewBlock) return false;

        var SelectedBlockTemplate = selectBlockTemplate(options);
        var tmpBlockTemplate = new SelectedBlockTemplate(
            jobCounter.next(),
            rpcData,
            _this.extraNoncePlaceholder,
            options.recipients,
            options.poolAddressScript,
            options.poolHex,
            options.coin,
            options.daemon
        );

        this.currentJob = tmpBlockTemplate;
        this.validJobs = {};
        _this.emit('newBlock', tmpBlockTemplate);
        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        return true;
    };


    this.processShare = function(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName, mixHash){
        var shareError = function(error){
            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return {error: error, result: null};
        };

        var submitTime = Date.now() / 1000 | 0;
        var job = this.validJobs[jobId];

        if (typeof job === 'undefined' || job.jobId != jobId) {
            return shareError([21, 'job not found']);
        }

        // イーサリアムの場合
        if (options.coin.type === 'ethereum') {
            // nonceとmixHashのフォーマットを確認
            if (typeof nonce !== 'string' || nonce.length !== 18) { // '0x' + 16 characters
                return shareError([20, 'incorrect size of nonce']);
            }
            if (typeof mixHash !== 'string' || mixHash.length !== 66) { // '0x' + 64 characters
                return shareError([20, 'incorrect size of mixHash']);
            }

            if (!job.registerSubmit(nonce, mixHash)) {
                return shareError([22, 'duplicate share']);
            }

            // シェアの検証
            if (job.validShare(job.target, nonce, mixHash)) {
                var blockHex = job.serializeBlock(mixHash, nonce);
                _this.emit('share', {
                    job: jobId,
                    ip: ipAddress,
                    port: port,
                    worker: workerName,
                    difficulty: difficulty,
                    blockHash: blockHex.headerHash,
                    nonce: nonce,
                    mixHash: mixHash
                }, blockHex);
                return {result: true, error: null, blockHash: blockHex.headerHash};
            } else {
                return shareError([23, 'invalid share']);
            }
        }
        // Equihashの場合
        else if (options.coin.type === 'equihash') {
            if (!job.registerSubmit(nonce, soln)) {
                return shareError([22, 'duplicate share']);
            }

            var header = job.serializeHeader();
            var blockHash;
            var blockHex;

            // ソリューションの検証
            if (job.validSolution(header, soln)) {
                blockHex = job.serializeBlock(header, soln);
                blockHash = util.reverseBuffer(util.sha256d(header)).toString('hex');
            } else {
                return shareError([23, 'invalid solution']);
            }

            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                port: port,
                worker: workerName,
                height: job.rpcData.height,
                difficulty: difficulty,
                blockHash: blockHash
            }, blockHex);

            return {result: true, error: null, blockHash: blockHash};
        }
        // その他のコインの場合
        else {
            if (extraNonce2.length / 2 !== _this.extraNonce2Size)
                return shareError([20, 'incorrect size of extranonce2']);

            if (nTime.length !== 8) {
                return shareError([20, 'incorrect size of ntime']);
            }

            var nTimeInt = parseInt(nTime, 16);
            if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
                return shareError([20, 'ntime out of range']);
            }

            if (nonce.length !== 8) {
                return shareError([20, 'incorrect size of nonce']);
            }

            if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
                return shareError([22, 'duplicate share']);
            }

            var extraNonce1Buffer = Buffer.from(extraNonce1, 'hex');
            var extraNonce2Buffer = Buffer.from(extraNonce2, 'hex');

            var coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
            var coinbaseHash = coinbaseHasher(coinbaseBuffer);

            var merkleRoot = util.reverseBuffer(job.merkleTree.withFirst(coinbaseHash)).toString('hex');

            var headerBuffer = job.serializeHeader(merkleRoot, nTime, nonce);
            var headerHash = hashDigest(headerBuffer, nTimeInt);
            var headerBigNum = bignum.fromBuffer(headerHash, {endian: 'little', size: 32});

            var blockHashInvalid;
            var blockHash;
            var blockHex;

            var shareDiff = diff1 / headerBigNum.toNumber() * shareMultiplier;
            var blockDiffAdjusted = job.difficulty * shareMultiplier;

            var getBlockHexAndHash = function() {
                switch(options.coin.algorithm) {
                    case 'yespowerr16':
                    case 'yescrypt':
                    case 'yescryptR8':
                    case 'yescryptR16':
                    case 'yescryptR32':
                        if (job.target.ge(headerBigNum)) {
                            var powHash = hashDigest(headerBuffer);
                            var powHashBigNum = bignum.fromBuffer(powHash, {endian: 'little', size: 32});
                            if (powHashBigNum.le(job.target)) {
                                return {
                                    hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                    hash: util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex')
                                };
                            }
                        }
                        break;
                    case 'ghostrider':
                    case 'firopow':
                    case 'kawpow':
                    case 'progpow':
                        if (job.target.ge(headerBigNum)) {
                            return {
                                hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                hash: util.reverseBuffer(hashDigest(headerBuffer)).toString('hex')
                            };
                        }
                        break;
                    case 'equihash':
                        if (job.target.ge(headerBigNum)) {
                            return {
                                hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                hash: util.reverseBuffer(hashDigest(headerBuffer)).toString('hex')
                            };
                        }
                        break;
                    case 'verushash':
                        if (job.target.ge(headerBigNum)) {
                            if (options.coin.symbol === 'VRSC') {
                                return {
                                    hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                    hash: util.reverseBuffer(hashDigest(headerBuffer)).toString('hex')
                                };
                            }
                        }
                        break;
                    // KMD特別処理
                    case 'equihash':
                        if (options.coin.symbol === 'KMD' && job.target.ge(headerBigNum)) {
                            var kmdHash = util.reverseBuffer(hashDigest(headerBuffer));
                            // notaryPayかどうかをチェック
                            if (job.rpcData.notarypaycontent) {
                                var notaryHash = util.sha256d(Buffer.from(job.rpcData.notarypaycontent, 'hex'));
                                if (kmdHash.equals(notaryHash)) {
                                    return {
                                        hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                        hash: kmdHash.toString('hex')
                                    };
                                }
                            } else {
                                return {
                                    hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                    hash: kmdHash.toString('hex')
                                };
                            }
                        }
                        break;
                    default:
                        if (job.target.ge(headerBigNum)) {
                            return {
                                hex: job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex'),
                                hash: blockHasher(headerBuffer, nTime).toString('hex')
                            };
                        }
                }
                return null;
            };

            var result = getBlockHexAndHash();
            if (result) {
                blockHex = result.hex;
                blockHash = result.hash;
            }
            else {
                if (options.emitInvalidBlockHashes)
                    blockHashInvalid = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');

                if (shareDiff / difficulty < 0.99){
                    if (previousDifficulty && shareDiff >= previousDifficulty){
                        difficulty = previousDifficulty;
                    }
                    else{
                        return shareError([23, 'low difficulty share of ' + shareDiff]);
                    }
                }
            }

            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                port: port,
                worker: workerName,
                height: job.rpcData.height,
                blockReward: job.rpcData.coinbasevalue,
                difficulty: difficulty,
                shareDiff: shareDiff.toFixed(8),
                blockDiff : blockDiffAdjusted,
                blockDiffActual: job.difficulty,
                blockHash: blockHash,
                blockHashInvalid: blockHashInvalid
            }, blockHex);

            return {result: true, error: null, blockHash: blockHash};
        }
    };
};
JobManager.prototype.__proto__ = events.EventEmitter.prototype;
