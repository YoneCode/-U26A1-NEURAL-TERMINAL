import { createClient } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

const HASH = '0x8136f2a29bc02ec54a53600adc087282a3795c9106823dd723ca7d843f137792';

const client = createClient({ chain: testnetBradbury });
const tx = await client.getTransaction({ hash: HASH });

console.log('Status         :', tx.statusName);
console.log('Result         :', tx.resultName);
console.log('Exec result    :', tx.txExecutionResultName);
console.log('Last leader    :', tx.lastLeader);
console.log('Votes committed:', String(tx.lastRound?.votesCommitted ?? 0));
console.log('Votes revealed :', String(tx.lastRound?.votesRevealed ?? 0));
console.log('Num validators :', String(tx.numOfInitialValidators));
