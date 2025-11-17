{
    //options1 : 是否创建中间目录（没有则创建）
    intermedirtes: true;
    //options2 : 部分文件超过 10mb 则采取分片写入
    chunkSize: 10 * 1024 * 1024;
    //options3 : 分片写入时，每个文件的后缀名
    chunkSuffix: ".chunk";
}