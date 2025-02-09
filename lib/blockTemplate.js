var bignum = require('bignum');
var merkle = require('./merkleTree.js');
var transactions = require('./transactions.js');
var util = require('./util.js');

var BlockTemplate = module.exports = function BlockTemplate(jobId, rpcData, extraNoncePlaceholder, recipients, poolAddress, poolHex, coin, daemon) {
    var submits = [];

    this.rpcData = rpcData;
    this.jobId = jobId;
    
    // Equihashパラメータのサポート
    this.algoNK = coin.parameters && coin.parameters.N && coin.parameters.K ? 
        coin.parameters.N+'_'+coin.parameters.K : undefined;
    this.persString = coin.parameters ? coin.parameters.personalization : undefined;

    // target情報の取得
    this.target = bignum(rpcData.target, 16);
    this.difficulty = parseFloat((diff1 / this.target.toNumber()).toFixed(9));

    // ブロック報酬の計算
    let blockReward = {
        'total': (this.rpcData.miner) * (coin.subsidyMultipleOfSatoshi || 100000000)
    };

    // funding streamsのサポート（Zcash用）
    if (coin.vFundingStreams) {
        let fundingstreamTotal = 0;
        for (var i = 0; i < this.rpcData.fundingstreams.length; i++) {
            fundingstreamTotal += this.rpcData.fundingstreams[i].valueZat;
        }

        blockReward = {
            "miner": (this.rpcData.miner * 100000000),
            "fundingstream": fundingstreamTotal,
            "total": (this.rpcData.miner * 100000000 + fundingstreamTotal)
        };
    }

    // トランザクション手数料の計算
    var fees = [];
    rpcData.transactions.forEach(function(value) {
        fees.push(value);
    });
    this.rewardFees = transactions.getFees(fees);
    rpcData.rewardFees = this.rewardFees;

    // コインベーストランザクションの生成
    if (typeof this.genTx === 'undefined') {
        this.genTx = transactions.createGeneration(
            rpcData,
            blockReward,
            this.rewardFees,
            recipients,
            poolAddress,
            poolHex,
            coin
        ).toString('hex');
        this.genTxHash = transactions.txHash();
    }

    // マークルツリーの生成
    this.prevHashReversed = util.reverseBuffer(new Buffer(rpcData.previousblockhash, 'hex')).toString('hex');
    
    // Sapling root hashのサポート
    if (rpcData.finalsaplingroothash) {
        this.hashReserved = util.reverseBuffer(new Buffer(rpcData.finalsaplingroothash, 'hex')).toString('hex');
    } else {
        this.hashReserved = '0000000000000000000000000000000000000000000000000000000000000000';
    }
    
    this.merkleRoot = merkle.getRoot(rpcData, this.genTxHash);
    this.merkleRootReversed = util.reverseBuffer(new Buffer(this.merkleRoot, 'hex')).toString('hex');

    // トランザクション情報の保存
    this.txCount = this.rpcData.transactions.length + 1;
    this.txs = [this.genTx];
    for (var tx of rpcData.transactions) {
        this.txs.push(tx.data);
    }

    // ブロックヘッダーのシリアライズ
    this.serializeHeader = function(nTime, nonce) {
        var getHeaderByAlgo = () => {
            switch(coin.algorithm) {
                case 'yespowerr16':
                case 'yescrypt':
                case 'yescryptR8':
                case 'yescryptR16':
                case 'yescryptR32':
                    var header = new Buffer(80);
                    var position = 0;
                    header.writeUInt32LE(this.rpcData.version, position, 4);
                    header.write(this.prevHashReversed, position += 4, 32, 'hex');
                    header.write(this.merkleRootReversed, position += 32, 32, 'hex');
                    header.write(nTime, position += 32, 4, 'hex');
                    header.write(util.reverseBuffer(new Buffer(rpcData.bits, 'hex')).toString('hex'), position += 4, 4, 'hex');
                    header.write(nonce, position += 4, 4, 'hex');
                    return header;

                case 'ghostrider':
                case 'firopow':
                case 'kawpow':
                case 'progpow':
                    var header = new Buffer(80);
                    var position = 0;
                    header.writeUInt32LE(this.rpcData.version, position, 4);
                    header.write(this.prevHashReversed, position += 4, 32, 'hex');
                    header.write(this.merkleRootReversed, position += 32, 32, 'hex');
                    header.write(nTime, position += 32, 4, 'hex');
                    header.write(util.reverseBuffer(new Buffer(rpcData.bits, 'hex')).toString('hex'), position += 4, 4, 'hex');
                    header.write(nonce, position += 4, 4, 'hex');
                    return header;

                case 'verushash':
                    if (coin.symbol === 'VRSC') {
                        var header = new Buffer(140);
                        var position = 0;
                        header.writeUInt32LE(this.rpcData.version, position, 4);
                        header.write(this.prevHashReversed, position += 4, 32, 'hex');
                        header.write(this.merkleRootReversed, position += 32, 32, 'hex');
                        header.write(this.hashReserved, position += 32, 32, 'hex');
                        header.write(nTime, position += 32, 4, 'hex');
                        header.write(util.reverseBuffer(new Buffer(rpcData.bits, 'hex')).toString('hex'), position += 4, 4, 'hex');
                        header.write(nonce, position += 4, 32, 'hex');
                        return header;
                    }
                    break;

                case 'equihash':
                    if (coin.symbol === 'KMD') {
                        var header = new Buffer(140);
                        var position = 0;
                        header.writeUInt32LE(this.rpcData.version, position, 4);
                        header.write(this.prevHashReversed, position += 4, 32, 'hex');
                        header.write(this.merkleRootReversed, position += 32, 32, 'hex');
                        header.write(this.hashReserved, position += 32, 32, 'hex');
                        header.write(nTime, position += 32, 4, 'hex');
                        header.write(util.reverseBuffer(new Buffer(rpcData.bits, 'hex')).toString('hex'), position += 4, 4, 'hex');
                        header.write(nonce, position += 4, 32, 'hex');
                        return header;
                    }
                    break;
            }

            // デフォルトヘッダー(140バイト)
            var header = new Buffer(140);
            var position = 0;
            header.writeUInt32LE(this.rpcData.version, position, 4);
            header.write(this.prevHashReversed, position += 4, 32, 'hex');
            header.write(this.merkleRootReversed, position += 32, 32, 'hex');
            header.write(this.hashReserved, position += 32, 32, 'hex');
            header.write(nTime, position += 32, 4, 'hex');
            header.write(util.reverseBuffer(new Buffer(rpcData.bits, 'hex')).toString('hex'), position += 4, 4, 'hex');
            header.write(nonce, position += 4, 32, 'hex');
            return header;
        };

        return getHeaderByAlgo();
        
        return header;
    };

    // ブロック全体のシリアライズ
    this.serializeBlock = function(header, soln) {
        var txCount = this.txCount.toString(16);
        if (Math.abs(txCount.length % 2) == 1) {
            txCount = "0" + txCount;
        }

        var varInt;
        if (this.txCount <= 0xfc) {
            varInt = new Buffer(txCount, 'hex');
        } else if (this.txCount <= 0x7fff) {
            if (txCount.length == 2) {
                txCount = "00" + txCount;
            }
            varInt = new Buffer.concat([Buffer.from('FD', 'hex'), util.reverseBuffer(new Buffer(txCount, 'hex'))]);
        }

        var getBlockByAlgo = () => {
            switch(coin.algorithm) {
                case 'yespowerr16':
                case 'yescrypt':
                case 'yescryptR8':
                case 'yescryptR16':
                case 'yescryptR32':
                case 'ghostrider':
                case 'firopow':
                case 'kawpow':
                case 'progpow':
                    return Buffer.concat([
                        header,
                        varInt,
                        Buffer.from(this.genTx, 'hex'),
                        ...this.rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex'))
                    ]);

                case 'verushash':
                    if (coin.symbol === 'VRSC') {
                        return Buffer.concat([
                            header,
                            varInt,
                            Buffer.from(this.genTx, 'hex'),
                            ...this.rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex'))
                        ]);
                    }
                    break;

                case 'equihash':
                    if (coin.symbol === 'KMD') {
                        // KMDの特別処理
                        if (this.rpcData.notarypaycontent) {
                            return Buffer.concat([
                                header,
                                Buffer.from(this.rpcData.notarypaycontent, 'hex'),
                                varInt,
                                Buffer.from(this.genTx, 'hex'),
                                ...this.rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex'))
                            ]);
                        }
                        return Buffer.concat([
                            header,
                            soln,
                            varInt,
                            Buffer.from(this.genTx, 'hex'),
                            ...this.rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex'))
                        ]);
                    }
                    // その他のEquihashコイン
                    return Buffer.concat([
                        header,
                        soln,
                        varInt,
                        Buffer.from(this.genTx, 'hex'),
                        ...this.rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex'))
                    ]);
            }

            // デフォルトの処理
            return Buffer.concat([
                header,
                soln,
                varInt,
                Buffer.from(this.genTx, 'hex'),
                ...this.rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex'))
            ]);
        };

        return getBlockByAlgo();
    };

    // シェアの登録
    this.registerSubmit = function(header, soln) {
        var submission = (header + soln).toLowerCase();
        if (submits.indexOf(submission) === -1) {
            submits.push(submission);
            return true;
        }
        return false;
    };

    // マイニング通知用のパラメータ
    this.getJobParams = function() {
        if (!this.jobParams) {
            this.jobParams = [
                this.jobId,
                util.packUInt32LE(this.rpcData.version).toString('hex'),
                this.prevHashReversed,
                this.merkleRootReversed,
                this.hashReserved,
                util.packUInt32LE(rpcData.curtime).toString('hex'),
                util.reverseBuffer(new Buffer(this.rpcData.bits, 'hex')).toString('hex'),
                true,
                this.algoNK,
                this.persString
            ];
        }
        return this.jobParams;
    };
};
