import test from 'node:test';
import assert from 'node:assert/strict';
import {merchant,installMerchant,DEFAULT_MERCHANT} from '../core/merchant.mjs';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
test('installation source retains trusted shop identity and excludes unrelated URL data',()=>{
 const input={name:'示例店铺',url:'https://shop.biuuka.com/demo-mall?storeId=42&token=private&next=evil'};
 const expected={name:input.name,url:'https://shop.biuuka.com/demo-mall?storeId=42'};
 assert.deepEqual(installMerchant(encode(input)),expected);
 assert.deepEqual(installMerchant(undefined,expected),expected);
 assert.deepEqual(installMerchant(undefined),DEFAULT_MERCHANT);
});
test('installation source rejects shell payloads, unsafe URLs and domain impersonation',()=>{
 for(const url of ['https://biuuka.com.evil.test/','http://biuuka.com','https://biuuka.com:444/','javascript:alert(1)','https://u:p@biuuka.com','https://biuuka.com/#token'])assert.equal(merchant({name:'商城',url}),null);
 assert.equal(merchant({name:'a\nb',url:DEFAULT_MERCHANT.url}),null);
 for(const value of ['x&cmd','a'.repeat(4097),encode({name:'商城',url:'https://evil.test'})])assert.deepEqual(installMerchant(value),DEFAULT_MERCHANT);
});

test('malformed source falls back to brxj without trusting or echoing the input',()=>{
 const previous={name:'既有店铺',url:'https://shop.biuuka.com/'};
 for(const input of [encode(previous)+'\\','not-json',Buffer.from('{').toString('base64url'),encode(null),encode({}),encode({name:'错误来源',url:'https://biuuka.com.evil.test'}),encode({name:'错误来源',url:'http://biuuka.com'}),{},42]){
  assert.deepEqual(installMerchant(input,previous),DEFAULT_MERCHANT);
 }
 assert.deepEqual(installMerchant(undefined,{name:'错误旧配置',url:'https://evil.test'}),DEFAULT_MERCHANT);
 assert.deepEqual(installMerchant(encode(previous)),previous);
});

test('missing and historical default shop resolve to brxj while existing shops survive upgrades',()=>{
 assert.equal(installMerchant(undefined).url,'https://brxj.biuuka.com/');
 assert.equal(installMerchant(undefined,{name:'Biuuka',url:'https://biuuka.com/'}).url,'https://brxj.biuuka.com/');
 for(const previous of [{name:'原商城',url:'https://biuuka.com/'},{name:'Biuuka',url:'https://biuuka.com/?shopId=7'},{name:'店铺',url:'https://shop.biuuka.com/'}])assert.deepEqual(installMerchant(undefined,previous),previous);
});
