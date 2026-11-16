import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {
 name:'Codetic AI',short_name:'Codetic',description:'Your conversations, connected.',
 start_url:'/status',display:'standalone',background_color:'#faf9f6',theme_color:'#e76c2c',
 icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]
};}
