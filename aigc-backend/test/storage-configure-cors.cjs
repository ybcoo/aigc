const { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } = require('@aws-sdk/client-s3');
require('dotenv/config');
const origins=[...new Set((process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map(value=>new URL(value.trim()).origin))];
if(origins.some(origin=>origin==='null'))throw new Error('FRONTEND_ORIGIN 必须是有效的前端来源');
const client=new S3Client({endpoint:process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,region:process.env.R2_REGION || 'auto',credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
async function main(){
  let rules=[];
  try{rules=(await client.send(new GetBucketCorsCommand({Bucket:process.env.R2_BUCKET}),{abortSignal:AbortSignal.timeout(30000)})).CORSRules || []}
  catch(error){if(!['NoSuchCORSConfiguration','NoSuchCORS'].includes(error.name))throw error}
  const rule={ID:'aigc-frontend-read',AllowedOrigins:origins,AllowedMethods:['GET','HEAD'],AllowedHeaders:['Range','Content-Type'],ExposeHeaders:['ETag','Content-Length','Content-Range','Accept-Ranges'],MaxAgeSeconds:3600};
  await client.send(new PutBucketCorsCommand({Bucket:process.env.R2_BUCKET,CORSConfiguration:{CORSRules:[...rules.filter(item=>item.ID!==rule.ID),rule]}}),{abortSignal:AbortSignal.timeout(30000)});
  console.log(JSON.stringify({cors:'configured',origins,methods:rule.AllowedMethods,preservedRules:rules.filter(item=>item.ID!==rule.ID).length}));
}
main().catch(error=>{console.error(`R2 CORS 配置失败：${error.name}${error.$metadata?.httpStatusCode?` HTTP ${error.$metadata.httpStatusCode}`:''}`);process.exitCode=1}).finally(()=>client.destroy());
