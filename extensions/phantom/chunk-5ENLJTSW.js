import{db as h,l as c,m as T}from"./chunk-57EVB5FV.js";import{$ as x}from"./chunk-N6SSDFMX.js";import{nc as f}from"./chunk-W7IWPUIQ.js";import{ua as m}from"./chunk-DJGGVTSJ.js";import{a as d}from"./chunk-RWWUDPHX.js";import{Ca as n,a as g,b as p}from"./chunk-LQZGQEJ6.js";import{a,g as r,i as s,n as l}from"./chunk-WKJYWAXG.js";s();l();var w=r(g(),1);var k=r(p(),1),b=a(o=>{let{txHash:t}=o,{data:i}=f(m.Solana),u=t&&i?{id:t,networkID:i}:void 0,{data:e}=x(u),R=(0,w.useCallback)(()=>{e&&self.open(e)},[e]);return(0,k.jsx)(y,{opacity:t?1:0,onClick:R,children:o.children})},"TransactionLink"),y=T(h).attrs({size:16,weight:500,color:n.colors.legacy.spotBase})`
  margin-top: 18px;
  text-decoration: none;
  ${o=>o.opacity===0?c`
          pointer-events: none;
        `:c`
          &:hover {
            cursor: pointer;
            color: ${d(n.colors.legacy.spotAccent,.5)};
          }
        `}
  }
`;export{b as a};
//# sourceMappingURL=chunk-5ENLJTSW.js.map
