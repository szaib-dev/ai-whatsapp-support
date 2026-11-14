import 'server-only';
export async function verifyAdminToken(token:string){
 if(!token||token.length>12000)return false;
 try{const response=await fetch(`${process.env.API_INTERNAL_URL||'http://127.0.0.1:3101'}/admin/session`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(12000)});return response.ok;}catch{return false;}
}
export const adminCookie='codetic_admin';
