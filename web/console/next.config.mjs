export default {
 output:'export', poweredByHeader:false, images:{unoptimized:true},
 generateBuildId:async()=>process.env.BIUUKA_CONSOLE_BUILD||'biuuka-console',
 experimental:{cpus:2},
};
