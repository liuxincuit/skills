#!/usr/bin/env python3
"""
YouTrack 工作总结生成器
从 YouTrack API 获取工作时间记录并生成结构化报告
"""

import os
import sys
import json
import argparse
import requests
from datetime import datetime, timedelta
from collections import defaultdict

# Windows终端UTF-8编码支持
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


class YouTrackSummary:
    """YouTrack 工作报告生成器"""

    def __init__(self, token=None, base_url=None):
        """初始化，读取配置"""
        self.token = token or os.getenv('SUPERMAP_YOUTRACK_TOKEN')
        if not self.token:
            print("错误: 未设置 SUPERMAP_YOUTRACK_TOKEN 环境变量")
            print("请设置环境变量: export SUPERMAP_YOUTRACK_TOKEN='your-token-here'")
            sys.exit(1)
        self.base_url = base_url or os.getenv('YOUTRACK_URL', 'http://yt.ispeco.com:8099')
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json"
        }
    
    def parse_time_range(self, time_range_str):
        """解析时间范围字符串"""
        time_range_str = time_range_str.strip()
        now = datetime.now()
        
        # 处理相对时间
        if time_range_str == '本月':
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            if start.month == 12:
                end = start.replace(year=start.year + 1, month=1)
            else:
                end = start.replace(month=start.month + 1)
            return start, end
        
        elif time_range_str == '上个月':
            first_day_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = first_day_this_month
            if end.month == 1:
                start = end.replace(year=end.year - 1, month=12)
            else:
                start = end.replace(month=end.month - 1)
            return start, end
        
        elif time_range_str == '上周':
            today = now.date()
            monday = today - timedelta(days=today.weekday() + 7)
            sunday = monday + timedelta(days=6)
            start = datetime.combine(monday, datetime.min.time())
            end = datetime.combine(sunday, datetime.max.time())
            return start, end
        
        # 处理月份格式：2026-01 或 2026年1月
        import re
        month_match = re.match(r'(\d{4})[\-年](\d{1,2})月?$', time_range_str)
        if month_match:
            year = int(month_match.group(1))
            month = int(month_match.group(2))
            start = datetime(year, month, 1)
            if month == 12:
                end = datetime(year + 1, 1, 1)
            else:
                end = datetime(year, month + 1, 1)
            return start, end
        
        # 处理日期范围：2026-01-01到2026-01-31
        range_match = re.match(r'(\d{4}-\d{2}-\d{2})[到~\-](\d{4}-\d{2}-\d{2})', time_range_str)
        if range_match:
            start = datetime.strptime(range_match.group(1), '%Y-%m-%d')
            end = datetime.strptime(range_match.group(2), '%Y-%m-%d') + timedelta(days=1)
            return start, end
        
        raise ValueError(f"无法解析时间范围: {time_range_str}")
    
    def get_current_user_id(self):
        """获取当前用户ID"""
        try:
            response = requests.get(
                f"{self.base_url}/api/users/me",
                headers=self.headers,
                timeout=10
            )
            response.raise_for_status()
            user_data = response.json()
            return user_data.get('id', '1-61')  # 默认使用已知ID
        except Exception as e:
            print(f"获取用户信息失败，使用默认ID: {e}")
            return '1-61'
    
    def fetch_work_items(self, start_date, end_date):
        """从 YouTrack API 获取工作项"""
        # 转换为毫秒时间戳
        start_ms = int(start_date.timestamp() * 1000)
        end_ms = int(end_date.timestamp() * 1000)
        
        # 获取当前用户ID
        author_id = self.get_current_user_id()
        
        fields = "id,date,duration(minutes,presentation),issue(id,idReadable,summary),text"
        all_items = []
        skip = 0
        page_size = 50
        
        while True:
            params = {
                "author": author_id,
                "fields": fields,
                "$top": page_size,
                "$skip": skip,
                "start": start_ms,
                "end": end_ms
            }
            
            try:
                response = requests.get(
                    f"{self.base_url}/api/workItems",
                    headers=self.headers,
                    params=params,
                    timeout=30
                )
                response.raise_for_status()
                items = response.json()
                
                if not items:
                    break
                
                all_items.extend(items)
                
                if len(items) < page_size:
                    break
                    
                skip += page_size
                
            except requests.exceptions.RequestException as e:
                print(f"API 调用失败: {e}")
                sys.exit(1)
        
        return all_items
    
    def get_task_parent(self, task_id):
        """从 API 获取任务的父任务"""
        url = f"{self.base_url}/api/issues/{task_id}/links"
        params = {
            "fields": "id,direction,linkType(id,directed,sourceToTarget,targetToSource,aggregation),trimmedIssues(id,idReadable,summary)"
        }
        
        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=10)
            response.raise_for_status()
            links = response.json()
            
            for link in links:
                link_type = link.get('linkType', {})
                direction = link.get('direction', '')
                trimmed_issues = link.get('trimmedIssues', [])
                
                source_to_target = link_type.get('sourceToTarget', '')
                target_to_source = link_type.get('targetToSource', '')
                
                # 检查父子关系
                is_parent_child = ("parent for" in source_to_target or 
                                  "subtask of" in target_to_source)
                
                if is_parent_child and direction == 'INWARD' and trimmed_issues:
                    return {
                        'id': trimmed_issues[0].get('idReadable', ''),
                        'summary': trimmed_issues[0].get('summary', '')
                    }
            
            return None
            
        except Exception as e:
            print(f"获取任务 {task_id} 的父任务失败: {e}")
            return None
    
    def build_parent_task_map(self, task_ids):
        """构建父任务映射关系

        Returns:
            task_parent_map: Dict[str, Optional[dict]] - 子任务ID -> 父任务信息
            parent_children_map: Dict[str, List[str]] - 父任务ID -> 子任务ID列表
            no_parent_tasks: List[str] - 无父任务的任务ID列表
        """
        task_parent_map = {}
        parent_children_map = defaultdict(list)
        no_parent_tasks = []

        for task_id in task_ids:
            parent = self.get_task_parent(task_id)
            task_parent_map[task_id] = parent

            if parent:
                parent_id = parent['id']
                parent_children_map[parent_id].append(task_id)
            else:
                no_parent_tasks.append(task_id)

        return task_parent_map, parent_children_map, no_parent_tasks
    
    def group_by_task(self, work_items):
        """按任务分组工作项"""
        tasks = defaultdict(lambda: {
            'work_items': [],
            'dates': set(),
            'total_minutes': 0
        })
        
        for item in work_items:
            issue = item.get('issue', {})
            task_id = issue.get('idReadable', '')
            
            if not task_id:
                continue
            
            duration = item.get('duration', {})
            minutes = duration.get('minutes', 0)
            date_ts = item.get('date', 0)
            date = datetime.fromtimestamp(date_ts / 1000).strftime('%Y-%m-%d')
            
            tasks[task_id]['work_items'].append({
                'date': date,
                'minutes': minutes,
                'text': item.get('text', '')
            })
            tasks[task_id]['dates'].add(date)
            tasks[task_id]['total_minutes'] += minutes
            tasks[task_id]['summary'] = issue.get('summary', '')
            tasks[task_id]['id'] = task_id
        
        return tasks
    
    def generate_report(self, time_range_str, work_items):
        """生成工作报告"""
        if not work_items:
            return "指定时间范围内无工作记录。"

        # 按任务分组
        tasks = self.group_by_task(work_items)

        # 构建父任务映射
        task_ids = list(tasks.keys())
        task_parent_map, parent_children_map, no_parent_tasks = self.build_parent_task_map(task_ids)

        # 收集所有父任务信息
        parent_info_map = {}
        for task_id, parent in task_parent_map.items():
            if parent:
                parent_info_map[parent['id']] = parent

        # 生成报告
        lines = []
        lines.append("# YouTrack 工作内容总结")
        lines.append("")
        lines.append(f"**时间范围**: {time_range_str}")
        lines.append(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        lines.append("")
        lines.append("---")
        lines.append("")

        # 总体统计数据
        total_hours = sum(t['total_minutes'] for t in tasks.values()) / 60
        total_days = set()
        for task_data in tasks.values():
            total_days.update(task_data['dates'])

        # 父任务工时分布（用于后续表格）
        parent_hours = {}

        # 1. 渲染每个父任务分组
        for parent_id, child_task_ids in sorted(parent_children_map.items()):
            parent_info = parent_info_map.get(parent_id, {'id': parent_id, 'summary': '未知父任务'})
            parent_hours[parent_id] = self._render_parent_section(
                lines, parent_info, child_task_ids, tasks
            )

        # 2. 渲染"其他任务"分组（无父任务的任务）
        if no_parent_tasks:
            other_hours = self._render_other_tasks_section(lines, no_parent_tasks, tasks)
            parent_hours['其他任务'] = other_hours

        # 汇总表格
        lines.append("---")
        lines.append("")
        lines.append("## 📊 总体汇总")
        lines.append("")
        lines.append("| 统计项 | 数值 |")
        lines.append("|--------|------|")
        lines.append(f"| 父任务数 | {len(parent_children_map)} 个 |")
        lines.append(f"| 子任务数 | {len(tasks)} 个 |")
        lines.append(f"| 工作项数 | {len(work_items)} 个 |")
        lines.append(f"| 总工时 | {total_hours:.1f} 小时 |")
        lines.append(f"| 工作天数 | {len(total_days)} 天 |")
        lines.append("")

        # 各父任务工时分布
        if parent_hours:
            lines.append("### 各父任务工时分布")
            lines.append("")
            lines.append("| 父任务 | 工时 | 占比 |")
            lines.append("|--------|------|------|")
            for parent_id, hours in sorted(parent_hours.items(), key=lambda x: x[1], reverse=True):
                percentage = (hours / total_hours * 100) if total_hours > 0 else 0
                display_name = parent_id if parent_id == '其他任务' else parent_id
                lines.append(f"| {display_name} | {hours:.1f}h | {percentage:.0f}% |")
            lines.append("")

        return '\n'.join(lines)

    def _render_parent_section(self, lines, parent_info, child_task_ids, tasks):
        """渲染单个父任务分组，返回该父任务的工时合计"""
        parent_id = parent_info['id']
        parent_summary = parent_info['summary']

        # 计算该父任务下的工时和子任务
        child_count = len(child_task_ids)
        parent_total_minutes = 0

        for task_id in child_task_ids:
            if task_id in tasks:
                parent_total_minutes += tasks[task_id]['total_minutes']

        parent_total_hours = parent_total_minutes / 60

        # 父任务标题
        lines.append(f"## 📁 {parent_id}: {parent_summary}")
        lines.append(f"**子任务数量**: {child_count} 个 | **工时合计**: {parent_total_hours:.1f} 小时")
        lines.append("")

        # 子任务详情
        for task_id in sorted(child_task_ids):
            if task_id in tasks:
                self._render_task_detail(lines, task_id, tasks[task_id])

        lines.append("---")
        lines.append("")

        return parent_total_hours

    def _render_other_tasks_section(self, lines, no_parent_tasks, tasks):
        """渲染"其他任务"分组（无父任务的任务），返回工时合计"""
        other_total_minutes = 0

        for task_id in no_parent_tasks:
            if task_id in tasks:
                other_total_minutes += tasks[task_id]['total_minutes']

        other_total_hours = other_total_minutes / 60

        lines.append("## 📁 其他任务（无父任务）")
        lines.append(f"**子任务数量**: {len(no_parent_tasks)} 个 | **工时合计**: {other_total_hours:.1f} 小时")
        lines.append("")

        for task_id in sorted(no_parent_tasks):
            if task_id in tasks:
                self._render_task_detail(lines, task_id, tasks[task_id])

        lines.append("---")
        lines.append("")

        return other_total_hours

    def _render_task_detail(self, lines, task_id, task_data):
        """渲染单个子任务详情"""
        hours = task_data['total_minutes'] / 60
        days = sorted(task_data['dates'])

        lines.append(f"### {task_id}: {task_data['summary']}")
        lines.append(f"- **工作时间**: {hours:.1f}小时")
        lines.append(f"- **工作天数**: {len(days)}天 ({', '.join(days)})")
        lines.append(f"- **工作项数**: {len(task_data['work_items'])}个")
        lines.append(f"- **任务链接**: {self.base_url}/issue/{task_id}")

        # 工作内容（取第一个非空的）
        texts = [wi['text'] for wi in task_data['work_items'] if wi['text']]
        if texts:
            lines.append(f"- **工作内容**: {texts[0]}")
        lines.append("")
    
    def run(self, time_range_str):
        """运行总结流程"""
        print(f"正在分析时间范围: {time_range_str}")
        
        # 解析时间
        start_date, end_date = self.parse_time_range(time_range_str)
        print(f"时间范围: {start_date.strftime('%Y-%m-%d')} 到 {end_date.strftime('%Y-%m-%d')}")
        
        # 获取数据
        print("正在获取工作项数据...")
        work_items = self.fetch_work_items(start_date, end_date)
        print(f"获取到 {len(work_items)} 个工作项")
        
        # 生成报告
        report = self.generate_report(time_range_str, work_items)
        
        return report


def main():
    parser = argparse.ArgumentParser(description='YouTrack 工作报告生成器')
    parser.add_argument('time_range', help='时间范围，如 "2026-01"、"本月"、"上周"')
    parser.add_argument('--token', help='API Token (默认从 SUPERMAP_YOUTRACK_TOKEN 环境变量获取)')
    parser.add_argument('--base-url', help='YouTrack API 地址')

    args = parser.parse_args()

    summary = YouTrackSummary(
        token=args.token,
        base_url=args.base_url
    )

    report = summary.run(args.time_range)
    print(report)


if __name__ == '__main__':
    main()
