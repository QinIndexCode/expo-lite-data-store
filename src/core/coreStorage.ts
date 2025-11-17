//src/core/coreStorage.ts
import * as Storage from 'expo-file-system'

const STORAGE_KEY = 'expo-liteDBStore'
// 数据根目录
/*
 * 数据根目录、
 * 数据根目录下有一个子目录，子目录中的文件的名称为表名称
 * 每个表中的数据为json文件，但是后缀为 .ldb
 * 每个json文件中的所有key值为列名，value值为对应的行数据
 * 这就需要读取和写入时，需要对json文件进行解析和序列化
 */
const RootDir = new Storage.Directory(Storage.Paths.document,"expo-litedatastore")

