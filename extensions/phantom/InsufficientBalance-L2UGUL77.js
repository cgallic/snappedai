import{a as f,c as m}from"./chunk-YWSY7L4P.js";import{a as k}from"./chunk-7HKJSCWA.js";import"./chunk-Z6STPKGK.js";import{H as w,za as F}from"./chunk-VRODSUQC.js";import"./chunk-27WMCVHA.js";import"./chunk-TRIYFLMU.js";import"./chunk-J4XA5VC7.js";import"./chunk-DQWLAPQA.js";import"./chunk-IUNAS73H.js";import"./chunk-2LKSWQ7Y.js";import"./chunk-H4HL2VJ5.js";import"./chunk-QKX6QMZS.js";import"./chunk-5ENLJTSW.js";import"./chunk-ZMW27YAP.js";import"./chunk-QW5UCU4W.js";import"./chunk-X6Z5FRDC.js";import"./chunk-X4RRAJ67.js";import"./chunk-FFV6ZRAV.js";import"./chunk-END3S5WW.js";import"./chunk-OABENO2E.js";import"./chunk-VQU4JTIB.js";import"./chunk-ZMU6KWZP.js";import"./chunk-YSZRDBUS.js";import"./chunk-UE7TCZBL.js";import"./chunk-PFY5DZIQ.js";import"./chunk-L4NFABLQ.js";import"./chunk-P3JRRYSB.js";import"./chunk-GUZFMB3D.js";import"./chunk-N3C6FBKY.js";import"./chunk-CTKHELYY.js";import"./chunk-2L6X42XL.js";import"./chunk-2P4HZW3J.js";import"./chunk-OR3XQXDJ.js";import{c as T,d as b}from"./chunk-HLSJ3VIL.js";import{db as s,m as o}from"./chunk-57EVB5FV.js";import"./chunk-44HH5QGP.js";import"./chunk-WVRYN4MY.js";import"./chunk-2LSP5LV2.js";import"./chunk-HLWWEHZK.js";import"./chunk-5JGASDWN.js";import"./chunk-ZDPKBPMV.js";import"./chunk-DYQ7BPYX.js";import"./chunk-NMTPXQAP.js";import"./chunk-SIWEHH3L.js";import"./chunk-N6SSDFMX.js";import"./chunk-YJCG6GWC.js";import"./chunk-W7IWPUIQ.js";import"./chunk-4SCKDS7G.js";import{dc as l,kc as B,zc as h}from"./chunk-DJGGVTSJ.js";import"./chunk-FATTDLFQ.js";import"./chunk-2RWUL32J.js";import"./chunk-RWWUDPHX.js";import{Ca as a,Na as I,Z as C,a as P,b as x}from"./chunk-LQZGQEJ6.js";import"./chunk-FNC6PQ53.js";import"./chunk-5QQLABHI.js";import{a as d,g as r,i as y,n as g}from"./chunk-WKJYWAXG.js";y();g();var v=r(P(),1);var e=r(x(),1),N=o.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow-y: scroll;
`,S=o.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 90px;
`,V=o(s).attrs({size:28,weight:500,color:a.colors.legacy.textBase})`
  margin: 16px;
`,$=o(s).attrs({size:14,weight:400,lineHeight:17,color:a.colors.legacy.textDiminished})`
  max-width: 275px;

  span {
    color: white;
  }
`,q=d(({networkId:t,token:c})=>{let{t:n}=C(),{handleHideModalVisibility:p}=F(),u=(0,v.useCallback)(()=>{p("insufficientBalance")},[p]),R=t&&B(h(l.getChainID(t))),{canBuy:D,openBuy:M}=w({caip19:R||"",context:"modal",analyticsEvent:"fiatOnrampFromInsufficientBalance"}),i=t?l.getTokenSymbol(t):n("tokens");return(0,e.jsxs)(N,{children:[(0,e.jsx)("div",{children:(0,e.jsxs)(S,{children:[(0,e.jsx)(k,{type:"failure",backgroundWidth:75}),(0,e.jsx)(V,{children:n("insufficientBalancePrimaryText",{tokenSymbol:i})}),(0,e.jsx)($,{children:n("insufficientBalanceSecondaryText",{tokenSymbol:i})}),c?(0,e.jsxs)(I,{borderRadius:8,gap:1,marginTop:32,width:"100%",children:[(0,e.jsx)(f,{label:n("insufficientBalanceRemaining"),children:(0,e.jsx)(m,{color:a.colors.legacy.spotNegative,children:`${c.balance} ${i}`})}),(0,e.jsx)(f,{label:n("insufficientBalanceRequired"),children:(0,e.jsx)(m,{children:`${c.required} ${i}`})})]}):null]})}),D?(0,e.jsx)(b,{primaryText:n("buyAssetInterpolated",{tokenSymbol:i}),onPrimaryClicked:M,secondaryText:n("commandCancel"),onSecondaryClicked:u}):(0,e.jsx)(T,{onClick:u,children:n("commandCancel")})]})},"InsufficientBalance"),X=q;export{q as InsufficientBalance,X as default};
//# sourceMappingURL=InsufficientBalance-L2UGUL77.js.map
