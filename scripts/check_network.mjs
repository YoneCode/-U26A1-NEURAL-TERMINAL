const API = 'https://explorer-bradbury.genlayer.com/api/v1';

// Recent transactions — look for any FINALIZED ones
const txRes  = await fetch(`${API}/transactions?limit=10`);
const txData = await txRes.json();
console.log('=== Recent transactions ===');
for (const tx of (txData?.data ?? txData?.items ?? [])) {
  console.log(` ${tx.hash?.slice(0,18)}…  status:${tx.statusName ?? tx.status}  result:${tx.resultName ?? tx.result}`);
}

// Validators
const valRes  = await fetch(`${API}/validators?limit=10`);
const valData = await valRes.json();
const vals = valData?.data ?? valData?.items ?? [];
console.log(`\n=== Validators online: ${vals.length} ===`);
vals.slice(0, 5).forEach(v =>
  console.log(` ${v.address}  stake:${v.stake ?? '?'}  status:${v.status ?? '?'}`)
);
