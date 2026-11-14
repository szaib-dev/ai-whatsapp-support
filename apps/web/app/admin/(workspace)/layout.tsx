import {cookies} from 'next/headers';import {redirect} from 'next/navigation';import {adminCookie,verifyAdminToken} from '../../../lib/admin-session';
export const dynamic='force-dynamic';export const metadata={title:'Workspace | Codetic AI',robots:{index:false,follow:false}};
export default async function AdminLayout({children}:{children:React.ReactNode}){const jar=await cookies();if(!await verifyAdminToken(jar.get(adminCookie)?.value||''))redirect('/admin/login');return <>{children}</>}
