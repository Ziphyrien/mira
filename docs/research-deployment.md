# 研究部署与前端性能

## 对在途参与的影响

Cloudflare 的 [DO生命周期](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)说明代码更新会关闭旧对象并启动新实例。在途HTTP/RPC请求若访问旧实例存储会被停止并返回错误；仅不访问存储的在途请求可以完成。运行时系统更新还存在30秒期限。[代码更新说明](https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates)指出 Worker 与 DO 发布最终一致，可能在数秒至数分钟内存在新旧版本并存。

[Worker版本](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)不包含关联存储资源的数据变化，因此回滚代码不等于回滚数据。

Mira 先保存回答再请求模型；在等待时暴露 processing 状态。生成中断后，租约到期的读取可恢复预定路径；过期结果由租约标识隔离。新页面的草稿仅暂存在当前标签页 sessionStorage，提交成功或撤回后清理，浏览器拒绝存储时继续保留当前内存输入。旧版已打开页面没有这项保护，首次部署前需预留切换窗口。

答题请求携带协议版本；不匹配的旧页面收到明确刷新提示，结束与撤回仍保留独立入口。页面和API使用 no-store；带内容哈希的静态资源按构建缓存。兼容版本可正常发布，本次协议与存储结构升级应在确认在途参与情况后执行临时差异迁移，再恢复正式入口。临时入口部署和正式入口部署均可能触发对象切换。已有Cookie与对象身份保持不变。

## 首屏与排版

研究和参与路由保留服务端渲染。脚本尚未就绪时，用可访问加载指示与 inert 阻止看似可点的控件；初始化后恢复交互。方案编辑器按需加载。题干按容器宽度自然换行，长词允许断开，移动端非回答按钮允许换行。必要状态优先使用控件与视觉反馈，重要参与事实及操作后果保留文字说明。

`node scripts/research-performance.mjs` 根据生产manifest统计研究工作台与参与页的静态依赖闭包，输出压缩体积到 `.pi/fabric/research-performance.json`。它排除动态导入，是构建规模指标，不等于浏览器实际传输或用户体验分数。浏览器回归覆盖延迟脚本与320px视口；TTFB、LCP、INP等真实用户指标需在相应设备与网络下测量。

## 霞浦网络与time.is入口

公开DoH核验显示 `ink.zipawa.top` CNAME 指向 `time.is`，再指向Cloudflare地址。此方式借用了第三方域名当前解析的入口，与Cloudflare官方 BYOIP（接入自己拥有的IP前缀）不同。DNS地址可能变化，站点更快不能从另一网络的测试推出。

本工作环境开启全局TUN，系统DNS返回198.18网段与合成IPv6。这里的连接、TLS和TTFB包含代理路径，不代表霞浦直连。保留现有线路，比较需分别标记运营商、网络类型、直连/代理、IPv4/IPv6、时段及冷暖缓存，观察请求成功率与p50/p95，而非一次测速选IP。

优先完成应用层的脚本拆分、缓存和恢复。可将自有域名正常Worker路由作为基线，与当前入口在当地重复比较；若大陆访问仍不稳定，再评估可控的接入/CDN路径及部署成本。Cloudflare中国网络的产品条件需要单独核实，不能默认当前Workers服务迁过去即可改善。此次未修改DNS、TUN或线上路由。
