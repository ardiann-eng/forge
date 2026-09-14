import {chromium} from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('docs/screenshots',{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
for(const [name,url] of [['home','/'],['launch','/launch'],['flows','/flows']]){
 await page.goto(`http://127.0.0.1:3000${url}`);await page.waitForLoadState('networkidle');await page.screenshot({path:`docs/screenshots/${name}-desktop.png`,fullPage:true});
}
await page.setViewportSize({width:375,height:812});await page.goto('http://127.0.0.1:3000');await page.waitForLoadState('networkidle');await page.screenshot({path:'docs/screenshots/home-mobile.png',fullPage:true});
await browser.close();
