import{a as X}from"./chunk-6VGLYVDB.js";import{a as F}from"./chunk-5SJZCTJL.js";import{a as q}from"./chunk-GCV5JCBL.js";import{a as $}from"./chunk-XND7JEJY.js";import{b as K}from"./chunk-GJVP2RQ6.js";import{b as Z}from"./chunk-4ID6NIYC.js";import{za as J}from"./chunk-VRODSUQC.js";import{k as U}from"./chunk-27WMCVHA.js";import"./chunk-TRIYFLMU.js";import"./chunk-J4XA5VC7.js";import"./chunk-DQWLAPQA.js";import"./chunk-IUNAS73H.js";import"./chunk-2LKSWQ7Y.js";import"./chunk-H4HL2VJ5.js";import{a as M}from"./chunk-QKX6QMZS.js";import"./chunk-5ENLJTSW.js";import"./chunk-ZMW27YAP.js";import"./chunk-QW5UCU4W.js";import"./chunk-X6Z5FRDC.js";import"./chunk-X4RRAJ67.js";import{g as G}from"./chunk-FFV6ZRAV.js";import"./chunk-END3S5WW.js";import{a as Q}from"./chunk-OABENO2E.js";import"./chunk-VQU4JTIB.js";import"./chunk-ZMU6KWZP.js";import{a as B}from"./chunk-YSZRDBUS.js";import"./chunk-UE7TCZBL.js";import"./chunk-LWMQCF4H.js";import"./chunk-PFY5DZIQ.js";import"./chunk-L4NFABLQ.js";import"./chunk-P3JRRYSB.js";import"./chunk-GUZFMB3D.js";import"./chunk-N3C6FBKY.js";import"./chunk-CTKHELYY.js";import"./chunk-2L6X42XL.js";import"./chunk-2P4HZW3J.js";import"./chunk-OR3XQXDJ.js";import{c as O}from"./chunk-HLSJ3VIL.js";import{C as V,db as R,m as a}from"./chunk-57EVB5FV.js";import{T as A,X as _,Z as N,_ as z,p as E}from"./chunk-EAEMLYNM.js";import"./chunk-44HH5QGP.js";import"./chunk-WVRYN4MY.js";import"./chunk-2LSP5LV2.js";import"./chunk-HLWWEHZK.js";import"./chunk-5JGASDWN.js";import"./chunk-ZDPKBPMV.js";import"./chunk-DYQ7BPYX.js";import"./chunk-NMTPXQAP.js";import"./chunk-SIWEHH3L.js";import"./chunk-N6SSDFMX.js";import"./chunk-YJCG6GWC.js";import{vb as L}from"./chunk-W7IWPUIQ.js";import"./chunk-4SCKDS7G.js";import{Rd as v}from"./chunk-DJGGVTSJ.js";import"./chunk-FATTDLFQ.js";import"./chunk-2RWUL32J.js";import"./chunk-RWWUDPHX.js";import{Aa as k,Bb as P,Ca as y,Hb as D,Z as h,a as W,b as w}from"./chunk-LQZGQEJ6.js";import"./chunk-FNC6PQ53.js";import"./chunk-5QQLABHI.js";import{a as f,g as p,i as C,n as b}from"./chunk-WKJYWAXG.js";C();b();var n=p(W(),1);C();b();var Y=p(W(),1);var o=p(w(),1),et=k({marginLeft:4}),ot=a(M).attrs({align:"center",padding:"10px"})`
  background-color: ${y.colors.legacy.elementBase};
  border-radius: 6px;
  height: 74px;
  margin: 4px 0;
`,it=a.div`
  display: flex;
  align-items: center;
`,nt=a(Q)`
  flex: 1;
  min-width: 0;
  text-align: left;
  align-items: normal;
`,lt=a(R).attrs({size:16,weight:600,lineHeight:19,noWrap:!0,maxWidth:"175px",textAlign:"left"})``,st=a(R).attrs({color:y.colors.legacy.textDiminished,size:14,lineHeight:17,noWrap:!0})`
  text-align: left;
  margin-top: 5px;
`,at=a.div`
  width: 55px;
  min-width: 55px;
  max-width: 55px;
  height: 55px;
  min-height: 55px;
  max-height: 55px;
  aspect-ratio: 1;
  margin-right: 10px;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
`,j=Y.default.memo(t=>{let{t:l}=h(),{collection:i,unknownItem:c,isHidden:r,isSpam:m,onToggleHidden:g}=t,{name:d,id:u}=i,s=N(i),S=s?.chainData,x=z(i),I=_(s?.media,"image",!1,"small"),T=d||s?.name||c;return(0,o.jsxs)(ot,{children:[(0,o.jsx)(at,{children:m&&r?(0,o.jsx)(X,{width:32}):I?(0,o.jsx)(K,{uri:I}):E(S)?(0,o.jsx)(q,{...S.utxoDetails}):(0,o.jsx)(Z,{type:"image",width:42})}),(0,o.jsx)(M,{children:(0,o.jsxs)(nt,{children:[(0,o.jsxs)(it,{children:[(0,o.jsx)(lt,{children:T}),m?(0,o.jsx)(V,{className:et,fill:y.colors.legacy.spotWarning,height:16,width:16}):null]}),(0,o.jsx)(st,{children:l("collectiblesSearchNrOfItems",{nrOfItems:x})})]})}),(0,o.jsx)(F,{id:u,label:`${d} visible`,checked:!r,onChange:H=>{g(H.target.checked?"show":"hide")}})]})});var e=p(w(),1),rt=74,mt=10,ct=rt+mt,dt=20,pt=a.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
`,gt=a.div`
  position: relative;
  width: 100%;
`,ht=f(()=>{let{handleHideModalVisibility:t}=J(),{data:l,isPending:i}=L(),{viewState:c,viewStateLoading:r}=A({account:l}),m=(0,n.useCallback)(()=>t("collectiblesVisibility"),[t]),g=(0,n.useMemo)(()=>({...c,handleCloseModal:m}),[m,c]),d=(0,n.useMemo)(()=>i||r,[i,r]);return{data:g,loading:d}},"useProps"),ut=n.default.memo(t=>{let{t:l}=h(),i=(0,n.useRef)(null);return(0,n.useEffect)(()=>{setTimeout(()=>i.current?.focus(),200)},[]),(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)(gt,{children:(0,e.jsx)(G,{ref:i,tabIndex:0,placeholder:l("assetListSearch"),maxLength:v,onChange:t.handleSearch,value:t.searchQuery,name:"Search collectibles"})}),(0,e.jsx)(U,{children:(0,e.jsx)(P,{children:({height:c,width:r})=>(0,e.jsx)(D,{style:{padding:`${dt}px 0`},scrollToIndex:t.searchQuery!==t.debouncedSearchQuery?0:void 0,height:c,width:r,rowCount:t.listItems.length,rowHeight:ct,rowRenderer:m=>(0,e.jsx)(St,{...m,data:t.listItems,unknownItem:l("assetListUnknownToken"),getIsHidden:t.getIsHidden,getIsSpam:t.getIsSpam,getSpamStatus:t.getSpamStatus,onToggleHidden:t.onToggleHidden})})})})]})}),St=f(t=>{let{index:l,data:i,style:c,unknownItem:r,getIsHidden:m,getIsSpam:g,getSpamStatus:d,onToggleHidden:u}=t,s=i[l],S=m(s),x=g(s),I=d(s),T=(0,n.useCallback)(H=>u({item:s,status:H}),[u,s]);return(0,e.jsx)("div",{style:c,children:(0,e.jsx)(j,{collection:s,unknownItem:r,isHidden:S,isSpam:x,spamStatus:I,onToggleHidden:T})})},"ResultRowWrapper"),It=f(()=>{let{data:t,loading:l}=ht(),{t:i}=h();return(0,e.jsxs)(pt,{children:[l?(0,e.jsx)($,{}):(0,e.jsx)(ut,{...t}),(0,e.jsx)(B,{children:(0,e.jsx)(O,{onClick:t.handleCloseModal,children:i("commandClose")})})]})},"CollectiblesVisibilityPage"),Kt=It;export{It as CollectiblesVisibilityPage,Kt as default};
//# sourceMappingURL=CollectiblesVisibilityPage-3EHGGK25.js.map
