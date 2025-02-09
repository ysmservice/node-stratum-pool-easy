var BigNumber = require('bignumber.js');
var util = require('./util.js');

var EthashBlockTemplate = module.exports = function(jobId, rpcData) {
    var submits = [];

    this.rpcData = rpcData;
    this.jobId = jobId;

    this.target = rpcData[2];
    this.headerHash = rpcData[0];
    this.seedHash = rpcData[1];

    // headerHashをBufferに変換
    this.headerHashBuffer = Buffer.from(this.headerHash.replace('0x', ''), 'hex');
    
    // targetを数値に変換
    this.targetBigNum = new BigNumber(this.target);

    this.difficulty = parseFloat((2n ** 256n / BigInt('0x' + this.target.replace('0x', ''))) / 2n ** 32n);

    this.registerSubmit = function(nonce, mixHash){
        var submission = nonce + mixHash;
        if (submits.indexOf(submission) === -1){
            submits.push(submission);
            return true;
        }
        return false;
    };

    this.getJobParams = function(){
        if (!this.jobParams){
            this.jobParams = [
                this.headerHash,
                this.seedHash,
                this.target
            ];
        }
        return this.jobParams;
    };

    // Share validation
    this.serializeBlock = function(mixHash, nonce) {
        return {
            mixHash: mixHash,
            headerHash: this.headerHash,
            nonce: nonce
        };
    };

    // Check if share matches the difficulty target
    this.validShare = function(shareTarget, nonce, mixHash) {
        var multiHashing = require('multi-hashing');
        try {
            // まずethash_submit_hashで試す
            var result = multiHashing.ethash_submit_hash(
                this.headerHashBuffer,
                Buffer.from(nonce.replace('0x', ''), 'hex'),
                Buffer.from(mixHash.replace('0x', ''), 'hex')
            );

            // 次にethash_submit_workで試す
            if (!result) {
                result = multiHashing.ethash_submit_work(
                    this.headerHashBuffer,
                    Buffer.from(nonce.replace('0x', ''), 'hex'),
                    Buffer.from(mixHash.replace('0x', ''), 'hex')
                );
            }
            
            // targetと比較
            if (result) {
                var resultBigNum = new BigNumber('0x' + result.toString('hex'));
                return resultBigNum.lte(this.targetBigNum);
            }
            return false;
        } catch (e) {
            return false;
        }
    };
};