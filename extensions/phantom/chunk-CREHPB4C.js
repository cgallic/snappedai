import{a as Q,c as $,d as J}from"./chunk-TRIYFLMU.js";import{b as q}from"./chunk-2LKSWQ7Y.js";import{c as Y}from"./chunk-ZMW27YAP.js";import{g as x}from"./chunk-VQU4JTIB.js";import{a as _,d as K}from"./chunk-HLSJ3VIL.js";import{db as a,m as n}from"./chunk-57EVB5FV.js";import{M as H,V as U,Z as O,ba as W,t as D,z}from"./chunk-HLWWEHZK.js";import{M as I,Oa as N,eb as G,gb as R,z as F}from"./chunk-5JGASDWN.js";import{A as B,mc as M}from"./chunk-W7IWPUIQ.js";import{ra as V,s as w,t as P,ua as L,v as ht,zc as E}from"./chunk-DJGGVTSJ.js";import{Ca as i,Z as S,a as Ct,b,l as k}from"./chunk-LQZGQEJ6.js";import{a as s,g as f,i as v,n as A}from"./chunk-WKJYWAXG.js";v();A();var p=f(Ct(),1);var t=f(b(),1),Tt=s(r=>{let{t:e}=S(),{voteAccountPubkey:c}=r,{showStakeAccountCreateAndDelegateStatusModal:j,closeAllModals:tt}=q(),et=s(()=>{r.onClose(),tt()},"onCloseTxStatusView"),{data:ot}=M(V.Solana),{data:at}=N(),it=at?.totalQuantityString??"";R(ot,G.STAKE_FUNGIBLE);let{cluster:nt,connection:y}=I(),l=U(),rt=E(L.Solana),{data:st}=F({query:{data:rt}}),lt=st?.usd,o=(0,p.useMemo)(()=>l.results?.find(yt=>yt.voteAccountPubkey===c),[l.results,c]),ct=o?.info?.name??o?.info?.keybaseUsername??B(c),mt=Y(y),[m,C]=(0,p.useState)(""),d=k(m),g=w(1+(W(y).data??0)),h=O({balance:it,cluster:nt,rentExemptionMinimum:g}),dt=s(()=>C(h.toString()),"onSetMax"),ut=d.isLessThan(g),pt=d.isGreaterThan(h),gt=d.isFinite(),u=m&&ut?e("validatorViewAmountSOLRequiredToStakeInterpolated",{amount:g}):m&&pt?e("validatorViewInsufficientBalance"):"",ft=mt.isPending,T=gt&&!u&&!ft,St=s(()=>{j({lamports:P(d).toNumber(),votePubkey:c,usdPerSol:lt,onClose:et,validatorName:ct})},"onSubmit"),xt=o?.totalApy?H(o.totalApy):null;return(0,t.jsx)(vt,{children:l.isPending?(0,t.jsx)(_,{}):l.isError||!o?(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(x,{children:e("validatorViewPrimaryText")}),(0,t.jsx)(X,{children:(0,t.jsxs)(a,{size:16,color:i.colors.legacy.textDiminished,lineHeight:20,children:[e("validatorViewErrorFetching")," ",l.error?.message??""]})})]}):(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(x,{children:e("validatorViewPrimaryText")}),(0,t.jsxs)(X,{children:[(0,t.jsx)(a,{size:16,color:i.colors.legacy.textDiminished,lineHeight:20,margin:"0 0 20px 0",children:(0,t.jsxs)(D,{i18nKey:"validatorViewDescriptionInterpolated",children:["Choose how much SOL you\u2019d like to ",(0,t.jsx)("br",{}),"stake with this validator. ",(0,t.jsx)(Z,{href:z,children:"Learn more"})]})}),(0,t.jsx)(Q,{value:m,symbol:"SOL",alignSymbol:"right",buttonText:e("maxInputMax"),width:47,warning:!!u,onSetTarget:dt,onUserInput:C}),(0,t.jsx)(bt,{children:(0,t.jsx)(a,{color:u?i.colors.legacy.spotNegative:"transparent",size:16,textAlign:"left",children:u})}),(0,t.jsx)(wt,{onEdit:r.onClose}),(0,t.jsx)($,{identifier:o.voteAccountPubkey,name:o.info?.name,keybaseUsername:o.info?.keybaseUsername,iconUrl:o.info?.iconUrl,website:o.info?.website,data:[{label:e("validatorCardEstimatedApy"),value:(0,t.jsxs)(a,{textAlign:"right",weight:500,size:14,noWrap:!0,children:[xt,"%"]})},{label:e("validatorCardCommission"),value:(0,t.jsxs)(a,{textAlign:"right",weight:500,size:14,noWrap:!0,children:[o.commission,"%"]})},{label:e("validatorCardTotalStake"),value:(0,t.jsx)(a,{textAlign:"right",weight:500,size:14,noWrap:!0,children:(0,t.jsx)(J,{children:o.activatedStake})})}]})]}),(0,t.jsx)(At,{children:(0,t.jsx)(K,{primaryText:e("validatorViewActionButtonStake"),secondaryText:e("commandClose"),onPrimaryClicked:St,onSecondaryClicked:r.onClose,primaryTheme:T?"primary":"default",primaryDisabled:!T})})]})})},"StakeAmountPage"),ee=Tt,vt=n.div`
  display: grid;
  grid-template-rows: 42px auto 47px;
  height: 100%;
`,X=n.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`,Z=n.a.attrs({target:"_blank",rel:"noopener noreferrer"})`
  color: ${i.colors.legacy.spotBase};
  text-decoration: none;
  cursor: pointer;
`,At=n.section`
  display: flex;
  gap: 15px;
`,bt=n.div`
  width: 100%;
`,kt=n(a)`
  width: 100%;
  margin-top: 15px;
  > a {
    color: ${i.colors.legacy.spotBase};
    cursor: pointer;
  }
`,wt=s(r=>{let{t:e}=S();return(0,t.jsxs)(kt,{size:16,color:i.colors.legacy.textDiminished,lineHeight:20,textAlign:"left",children:[e("validatorViewValidator")," \u2022 ",(0,t.jsx)(Z,{onClick:r.onEdit,children:e("commandEdit")})]})},"ValidatorSectionLabel");export{Tt as a,ee as b};
//# sourceMappingURL=chunk-CREHPB4C.js.map
