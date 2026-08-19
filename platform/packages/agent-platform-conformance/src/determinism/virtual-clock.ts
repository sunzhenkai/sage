import type { VirtualClockPort } from '../contracts.js';
export class VirtualClock implements VirtualClockPort { constructor(private value=0){} now():number{return this.value;} advance(milliseconds:number):void{if(!Number.isInteger(milliseconds)||milliseconds<0)throw new TypeError('CLOCK_ADVANCE_INVALID');this.value+=milliseconds;} }
