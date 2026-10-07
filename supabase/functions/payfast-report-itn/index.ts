import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const md5=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("MD5",new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,"0")).join("");
const enc=(v:string)=>encodeURIComponent(v.trim()).replace(/%20/g,"+");
Deno.serve(async(req)=>{
 if(req.method!=="POST")return new Response("OK");
 const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const f=await req.formData(), d:Record<string,string>={}; for(const [k,v] of f.entries())d[k]=String(v);
 const merchant=Deno.env.get("PAYFAST_MERCHANT_ID")??"", pass=Deno.env.get("PAYFAST_PASSPHRASE")??"";
 if(!merchant||d.merchant_id!==merchant)return new Response("invalid merchant",{status:400});
 const raw=Object.entries(d).filter(([k,v])=>k!=="signature"&&v!=="").map(([k,v])=>k+"="+enc(v)).join("&")+(pass?"&passphrase="+enc(pass):"");
 if(await md5(raw)!==d.signature)return new Response("invalid signature",{status:400});
 const host=Deno.env.get("PAYFAST_SANDBOX")==="true"?"sandbox.payfast.co.za":"www.payfast.co.za";
 const validation=await fetch("https://"+host+"/eng/query/validate",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(d)});
 if((await validation.text()).trim()!=="VALID")return new Response("invalid ITN",{status:400});
 const {data:order}=await admin.from("report_orders").select("*").eq("id",d.m_payment_id).maybeSingle(); if(!order)return new Response("order not found",{status:404});
 if(Number(d.amount_gross).toFixed(2)!==Number(order.amount).toFixed(2))return new Response("amount mismatch",{status:400});
 if(d.payment_status==="COMPLETE"&&order.status!=="paid"){
   await admin.from("report_orders").update({status:"paid",provider:"payfast",provider_reference:d.pf_payment_id??d.m_payment_id,paid_at:new Date().toISOString()}).eq("id",order.id);
   const {data:insp}=await admin.from("inspections").select("report_price,payer_cut,inspector_cut").eq("id",order.inspection_id).single();
   if(insp)await admin.from("report_purchases").upsert({inspection_id:order.inspection_id,buyer_id:order.buyer_id,amount_paid:insp.report_price,payer_earning:insp.payer_cut,inspector_earning:insp.inspector_cut},{onConflict:"inspection_id,buyer_id"});
 }
 if(d.payment_status==="FAILED")await admin.from("report_orders").update({status:"failed",provider:"payfast",provider_reference:d.pf_payment_id??d.m_payment_id}).eq("id",order.id);
 return new Response("OK");
});