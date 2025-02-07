var events = require('events');
var crypto = require('crypto');

var bignum = require('bignum');



var util = require('./util.js');
var blockTemplate = require('./blockTemplate.js').df;
var blockTemplateEH = require('./blockTemplate.js').eh;

var vh = require('verushash');

const EH_PARAMS_MAP = {
    "125_4": {
        SOLUTION_LENGTH: 106,
        SOLUTION_SLICE: 2,
    },
    "144_5": {
        SOLUTION_LENGTH: 202,
        SOLUTION_SLICE: 2,
    },
    "192_7": {
        SOLUTION_LENGTH: 806,
        SOLUTION_SLICE: 6,
    },
    "200_9": {
        SOLUTION_LENGTH: 2694,
        SOLUTION_SLICE: 6,
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
//Unique job per new block template
var JobCounterEH = function () {
    var counter = 0x0000cccc;

    this.next = function () {
        counter++;
        if (counter % 0xffffffffff === 0)
            counter = 1;
        return this.cur();
    };

    this.cur = function () {
        return counter.toString(16);
    };
};
function isHexString(s) {
    var check = String(s).toLowerCase();
    if(check.length % 2) {
        return false;
    }
    for (i = 0; i < check.length; i=i+2) {
        var c = check[i] + check[i+1];
        if (!isHex(c))
            return false;
    }
    return true;
}
function isHex(c) {
    var a = parseInt(c,16);
    var b = a.toString(16).toLowerCase();
    if(b.length % 2) {
        b = '0' + b;
    }
    if (b !== c) {
        return false;
    }
    return true;
}
/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
**/
var JobManager = module.exports = function JobManager(options){


    //private members

    var _this = this;
    var jobCounter = new JobCounter();
    var jobCounterEH = new JobCounterEH();

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
            case 'sha1':
                return function (d) {
                    return util.reverseBuffer(util.sha256d(d));
                };
            case 'equihash':
                return function (d) {
                    return util.reverseBuffer(util.sha256(d));
                };
            case 'scrypt':
                if (options.coin.reward === 'POS') {
                    return function (d) {
                        return util.reverseBuffer(hashDigest.apply(this, arguments));
                    };
                }
            case 'scrypt-jane':
                if (options.coin.reward === 'POS') {
                    return function (d) {
                        return util.reverseBuffer(hashDigest.apply(this, arguments));
                    };
                }
            case 'scrypt-n':
                return function (d) {
                    return util.reverseBuffer(util.sha256d(d));
                };
            default:
                return function () {
                    return util.reverseBuffer(hashDigest.apply(this, arguments));
                };
        }
    })();

    this.updateCurrentJob = async function(rpcData){
        if (['eth', 'ethash', 'etchash'].includes(options.coin.algorithm)) {
            // ETH job branch: build a minimal job for ETC/ETH with extra ETH-specific properties
            let target = rpcData.target ? bignum(rpcData.target, 16) : util.bignumFromBitsHex(rpcData.bits);
            let tmpJob = {
                jobId: jobCounter.next(),
                rpcData: rpcData,
                target: target,
                difficulty: parseFloat((diff1 / target.toNumber()).toFixed(9)),
                // Extra ETH-specific properties:
                header: rpcData.header,       // typically the block header
                seedHash: rpcData.seedhash,     // for DAG generation
                // Attach getJobParams so that usage of job.getJobParams() doesn't error
                getJobParams: function(){
                    return [
                        this.jobId,
                        this.header,
                        this.seedHash,
                        this.target.toString(16)
                    ];
                },
                jobParams: [
                    this.jobId,
                    this.header,
                    this.seedHash,
                    this.target.toString(16)
                ];
            };

            _this.currentJob = tmpJob;
            _this.emit('updatedBlock', tmpJob, true);
            _this.validJobs[tmpJob.jobId] = tmpJob;
            return;
        }
        else if (options.coin.algorithm === 'equihash') {
            var tmpBlockTemplate = new blockTemplateEH(
                jobCounterEH.next(),
                rpcData,
                _this.extraNoncePlaceholder,
                options.recipients,
                options.address,
                options.poolHex,
                options.coin,
                options.daemon
            );
            if (rpcData.version == 3 && (options.coin.symbol == "zen" || options.coin.symbol == "zent")) {
                await tmpBlockTemplate.calculateTrees();
            }
        } else {
            var tmpBlockTemplate = new blockTemplate(
                jobCounter.next(),
                rpcData,
                options.poolAddressScript,
                _this.extraNoncePlaceholder,
                options.coin.reward,
                options.coin.txMessages,
                options.recipients
            );
        }
        _this.currentJob = tmpBlockTemplate;
        _this.emit('updatedBlock', tmpBlockTemplate, true);
        _this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;
    };

    //returns true if processed a new block
    this.processTemplate = async function(rpcData){

        /* Block is new if A) its the first block we have seen so far or B) the blockhash is different and the
           block height is greater than the one we have */
        var isNewBlock = typeof(_this.currentJob) === 'undefined';
        if  (!isNewBlock && _this.currentJob.rpcData.previousblockhash !== rpcData.previousblockhash){
            isNewBlock = true;

            //If new block is outdated/out-of-sync than return
            if (rpcData.height < _this.currentJob.rpcData.height)
                return false;
        }

        if (!isNewBlock) return false;


        if (['eth', 'ethash', 'etchash'].includes(options.coin.algorithm)) {
            // ETH job branch in processTemplate: build a new ETH job with extra properties and getJobParams
            let target = rpcData.target ? bignum(rpcData.target, 16) : util.bignumFromBitsHex(rpcData.bits);
            let tmpJob = {
                jobId: jobCounter.next(),
                rpcData: rpcData,
                target: target,
                difficulty: parseFloat((diff1 / target.toNumber()).toFixed(9)),
                // Extra ETH-specific properties:
                header: rpcData.header,       // block header for ETH
                seedHash: rpcData.seedhash,     // seed hash (for DAG)
                // Attach getJobParams so that job.getJobParams() is callable without error
                getJobParams: function(){
                    return [
                        this.jobId,
                        this.header,
                        this.seedHash,
                        this.target.toString(16)
                    ];
                }
            };
            this.currentJob = tmpJob;
            this.validJobs = {};
            _this.emit('newBlock', tmpJob);
            this.validJobs[tmpJob.jobId] = tmpJob;
            return true;
        }
        else if (options.coin.algorithm === 'equihash') {
            var tmpBlockTemplate = new blockTemplateEH(
                jobCounterEH.next(),
                rpcData,
                _this.extraNoncePlaceholder,
                options.recipients,
                options.address,
                options.poolHex,
                options.coin,
                options.daemon
            );
            if (rpcData.version == 3 && (options.coin.symbol == "zen" || options.coin.symbol == "zent")) {
                await tmpBlockTemplate.calculateTrees();
            }
        } else {
            var tmpBlockTemplate = new blockTemplate(
                jobCounter.next(),
                rpcData,
                options.poolAddressScript,
                _this.extraNoncePlaceholder,
                options.coin.reward,
                options.coin.txMessages,
                options.recipients
            );
        }

        this.currentJob = tmpBlockTemplate;

        this.validJobs = {};
        _this.emit('newBlock', tmpBlockTemplate);

        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        return true;

    };

    this.processShareETH = function(params, enonce1, difficulty, ipAddress, port, workerName){
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
        // ETH (ethash/etchash) support branch:
        if (['eth', 'ethash', 'etchash'].includes(options.coin.algorithm)) {
            let ethNonce, ethPowHash, ethMixDigest, shareDiff, blockCandidate;
            if (params.version == "v2") {
                let job = this.validJobs[params.jobId];
                if (typeof job === 'undefined' || job.jobId != jobId)
                    return shareError([21, 'job not found']);
                
                // Interpret parameters as:
                // extraNonce1: eth_nonce, extraNonce2: eth_powHash, nTime: eth_mixDigest
                ethNonce    = enonce1;
                ethPowHash  = params.nonce;
                ethMixDigest = params.mixDigest;
                
                let shareBigNum;
                try {
                    shareBigNum = bignum(ethPowHash, 16);
                } catch(e) {
                    return shareError([20, 'invalid powHash']);
                }
                
                shareDiff = diff1 / shareBigNum.toNumber() * shareMultiplier;
                blockCandidate = job.target.ge(shareBigNum);
            } else {
                let jobId = null;
                for (const [key, value] of Object.entries(validJobs)) {
                    if (value.rpcData.height == params.height) {
                        jobId = key;
                        break;
                }
                let job = this.validJobs[jobId];
                if (typeof job === 'undefined' || job.jobId != jobId)
                    return shareError([21, 'job not found']);
                let nonce = params.mixDigest;
                if (nonce.startsWith("0x")) {
                    ethPowHash =  nonce.slice(2);
                } else {
                    ethPowHash = nonce;
                }
                ethNonce    = enonce1;
                ethMixDigest = params.nonce;
                shareDiff = diff1 / headerBigNum.toNumber() * shareMultiplier;
                blockCandidate = job.target.ge(shareBigNum);
            }
            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                port: port,
                worker: workerName,
                eth: { nonce: ethNonce, powHash: ethPowHash, mixDigest: ethMixDigest },
                difficulty: difficulty,
                shareDiff: shareDiff.toFixed(8),
                blockCandidate: blockCandidate
            }, blockCandidate ? null : undefined);
            
            return { result: true, error: null, blockHash: blockCandidate ? ethPowHash : null };
        }
    }

    this.processShare = function(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName, soln = null){
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

        if (extraNonce2.length / 2 !== _this.extraNonce2Size)
            return shareError([20, 'incorrect size of extranonce2']);

        var job = this.validJobs[jobId];

        if (typeof job === 'undefined' || job.jobId != jobId ) {
            return shareError([21, 'job not found']);
        }

        if (nTime.length !== 8) {
            return shareError([20, 'incorrect size of ntime']);
        }

        var nTimeInt = parseInt(nTime, 16);
        if (options.coin.algorithm === 'equihash') {
            let nTimeInt = parseInt(nTime.substr(6, 2) + nTime.substr(4, 2) + nTime.substr(2, 2) + nTime.substr(0, 2), 16);
            if (Number.isNaN(nTimeInt)) {
                // console.log('Invalid nTime: ', nTimeInt, nTime)
                return shareError([20, 'invalid ntime'])
            }
            if (nonce.length !== 64) {
                // console.log('incorrect size of nonce');
                return shareError([20, 'incorrect size of nonce']);
            }
            let parameters = options.coin.parameters
            if (!parameters) {
                parameters = {
                    N: 200,
                    K: 9,
                    personalization: 'ZcashPoW'
                }
            }
            let N = parameters.N || 200
            let K = parameters.K || 9
            let expectedLength = EH_PARAMS_MAP[`${N}_${K}`].SOLUTION_LENGTH || 2694
            let solutionSlice = EH_PARAMS_MAP[`${N}_${K}`].SOLUTION_SLICE || 0
    
            if (soln.length !== expectedLength) {
                // console.log('Error: Incorrect size of solution (' + soln.length + '), expected ' + expectedLength);
                return shareError([20, 'Error: Incorrect size of solution (' + soln.length + '), expected ' + expectedLength]);
            }
    
            if (!isHexString(extraNonce2)) {
                // console.log('invalid hex in extraNonce2');
                return shareError([20, 'invalid hex in extraNonce2']);
            }
    
            if (!job.registerSubmitEH(nonce, soln)) {
                return shareError([22, 'duplicate share']);
            }
        } else {
            if (nonce.length !== 8) {
                return shareError([20, 'incorrect size of nonce']);
            }

            if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
                return shareError([20, 'ntime out of range']);
            }
    
            if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
                return shareError([22, 'duplicate share']);
            }
        }



        var extraNonce1Buffer = new Buffer(extraNonce1, 'hex');
        var extraNonce2Buffer = new Buffer(extraNonce2, 'hex');
        if (options.coin.algorithm === 'equihash') {
            var headerBuffer = job.serializeHeader(nTime, nonce); // 144 bytes (doesn't contain soln)
            var headerSolnBuffer = new Buffer.concat([headerBuffer, new Buffer(soln, 'hex')]);
            var headerHash;
    
            //console.log('processShare ck6')
    
            switch (options.coin.algorithm) {
                case 'verushash':
                    //console.log('processShare ck6a, buffer length: ', headerSolnBuffer.length)
                    headerHash = vh.hash(headerSolnBuffer);
                    break;
                default:
                    //console.log('processShare ck6b')
                    headerHash = util.sha256d(headerSolnBuffer);
                    break;
            };
            // check if valid solution
            if (hashDigest(headerBuffer, new Buffer(soln.slice(solutionSlice), 'hex')) !== true) {
                //console.log('invalid solution');
                return shareError([20, 'invalid solution']);
            }
        } else {
            var coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
            var coinbaseHash = coinbaseHasher(coinbaseBuffer);
    
            var merkleRoot = util.reverseBuffer(job.merkleTree.withFirst(coinbaseHash)).toString('hex');
    
            var headerBuffer = job.serializeHeader(merkleRoot, nTime, nonce);
            var headerHash = hashDigest(headerBuffer, nTimeInt);
        }
        var headerBigNum = bignum.fromBuffer(headerHash, {endian: 'little', size: 32});

        var blockHashInvalid;
        var blockHash;
        var blockHex;

        var shareDiff = diff1 / headerBigNum.toNumber() * shareMultiplier;

        var blockDiffAdjusted = job.difficulty * shareMultiplier;

        //Check if share is a block candidate (matched network difficulty)
        if (job.target.ge(headerBigNum)){
            if (options.coin.algorithm === 'equihash') {
                blockHex = job.serializeBlock(headerBuffer, new Buffer(soln, 'hex')).toString('hex');
                blockHash = util.reverseBuffer(headerHash).toString('hex');
            } else {
                blockHex = job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex');
                if (options.coin.algorithm === 'blake' || options.coin.algorithm === 'neoscrypt') {                
                    blockHash = util.reverseBuffer(util.sha256d(headerBuffer, nTime)).toString('hex');
                }
                else {
                    blockHash = blockHasher(headerBuffer, nTime).toString('hex');
                }
            }
        }
        else {
            if (options.emitInvalidBlockHashes) {
                if (options.coin.algorithm === 'equihash') {
                    blockHashInvalid = util.reverseBuffer(util.sha256d(headerSolnBuffer)).toString('hex');
                } else {
                    blockHashInvalid = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');
                }
            }
            //Check if share didn't reached the miner's difficulty)
            if (shareDiff / difficulty < 0.99){

                //Check if share matched a previous difficulty from before a vardiff retarget
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
    };
};
JobManager.prototype.__proto__ = events.EventEmitter.prototype;
