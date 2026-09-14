import {NextResponse} from 'next/server';
import {isAddress} from 'viem';
import {fileStore} from '@/lib/indexer/store';
import {forgeFactory,chain} from '@/lib/config';
export const dynamic='force-dynamic';
export async function GET(request:Request){const router=new URL(request.url).searchParams.get('router');if(!router||!isAddress(router))return NextResponse.json({error:'Invalid router.'},{status:400});const snapshot=await fileStore.load();if(!snapshot||snapshot.chainId!==chain.id||snapshot.factory.toLowerCase()!==forgeFactory?.toLowerCase())return NextResponse.json({launch:null});const event=snapshot.events.find(e=>e.event==='TokenLaunched'&&e.router?.toLowerCase()===router.toLowerCase());return NextResponse.json({launch:event||null});}
