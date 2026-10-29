import type {ReactNode} from 'react';
import './globals.css';
export const metadata={title:'Biuuka · 本机控制台',description:'管理这台电脑上的 Biuuka 服务、账号与授权。',icons:{icon:'/brand.svg'}};
export default function Layout({children}:{children:ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
